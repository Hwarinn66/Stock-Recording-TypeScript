import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'validators.dart';

/// UUID v4 acak: kunci pengiriman unik per transaksi. Server tidak mencatat dua kali
/// transaksi dengan kunci yang sama (sinyal putus setelah tersimpan, antrean dikirim ulang).
String newClientRef([Random? random]) {
  final rng = random ?? Random.secure();
  final bytes = List<int>.generate(16, (_) => rng.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versi 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // varian RFC 4122
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
      '${hex.substring(16, 20)}-${hex.substring(20)}';
}

/// Transaksi yang belum sampai ke server (atau ditolak server dan perlu dicek).
class QueuedTransaction {
  QueuedTransaction({
    required this.clientRef,
    required this.token,
    required this.mode,
    required this.quantity,
    required this.product,
    required this.recordedAt,
    this.reservationNumber,
    this.inCode,
    this.attempts = 0,
    this.lastError,
  });

  factory QueuedTransaction.fromJson(Map<String, dynamic> json) => QueuedTransaction(
    clientRef: json['client_ref'] as String,
    token: json['token'] as String,
    mode: Mode.values.firstWhere((m) => m.code == json['mode']),
    quantity: json['quantity'] as num,
    reservationNumber: json['reservation_number'] as String?,
    inCode: json['in_code'] as String?,
    product: Product.fromJson(json['product'] as Map<String, dynamic>),
    recordedAt: DateTime.parse(json['recorded_at'] as String),
    attempts: json['attempts'] as int? ?? 0,
    lastError: json['last_error'] as String?,
  );

  final String clientRef;
  final String token;
  final Mode mode;
  final num quantity;
  final String? reservationNumber;
  final String? inCode;
  final Product product;
  /// Waktu barang benar-benar masuk/keluar (dikirim ke server sebagai recorded_at).
  final DateTime recordedAt;
  int attempts;
  String? lastError;

  /// Perubahan stok bila transaksi ini tersimpan.
  num get delta => mode == Mode.inbound ? quantity : -quantity;

  Map<String, Object?> toJson() => {
    'client_ref': clientRef,
    'token': token,
    'mode': mode.code,
    'quantity': quantity,
    'reservation_number': reservationNumber,
    'in_code': inCode,
    'product': product.toJson(),
    'recorded_at': recordedAt.toUtc().toIso8601String(),
    'attempts': attempts,
    'last_error': lastError,
  };
}

/// Data offline di HP: daftar barang (agar QR tetap dikenali saat server mati),
/// antrean transaksi yang menunggu dikirim, dan transaksi yang ditolak server.
class OfflineStore extends ChangeNotifier {
  OfflineStore(this._prefs);

  final SharedPreferences _prefs;
  static const _pendingKey = 'offline_pending';
  static const _failedKey = 'offline_failed';
  static const _catalogKey = 'catalog';
  static const _catalogAtKey = 'catalog_updated_at';
  Map<String, Product>? _catalog;

  List<QueuedTransaction> get pending => _read(_pendingKey);
  List<QueuedTransaction> get failed => _read(_failedKey);

  List<QueuedTransaction> _read(String key) {
    final raw = _prefs.getString(key);
    if (raw == null) return [];
    return (jsonDecode(raw) as List)
        .map((e) => QueuedTransaction.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> _write(String key, List<QueuedTransaction> items) async {
    await _prefs.setString(key, jsonEncode(items.map((e) => e.toJson()).toList()));
    notifyListeners();
  }

  Future<void> enqueue(QueuedTransaction item) async {
    final items = pending;
    if (items.any((e) => e.clientRef == item.clientRef)) return;
    await _write(_pendingKey, items..add(item));
  }

  Future<void> removePending(String clientRef) =>
      _write(_pendingKey, pending..removeWhere((e) => e.clientRef == clientRef));

  Future<void> recordAttempt(String clientRef, String error) async {
    final items = pending;
    for (final item in items.where((e) => e.clientRef == clientRef)) {
      item.attempts++;
      item.lastError = error;
    }
    await _write(_pendingKey, items);
  }

  /// Ditolak server (mis. stok tidak cukup): dipindah ke daftar "perlu dicek".
  Future<void> moveToFailed(QueuedTransaction item, String reason) async {
    item.lastError = reason;
    await _write(_failedKey, failed..add(item));
    await removePending(item.clientRef);
  }

  /// Kirim ulang setelah masalahnya dibereskan (mis. stok sudah dikoreksi di web).
  Future<void> retryFailed(String clientRef) async {
    final items = failed;
    final item = items.where((e) => e.clientRef == clientRef).firstOrNull;
    if (item == null) return;
    await _write(_failedKey, items..remove(item));
    await enqueue(item..lastError = null);
  }

  Future<void> dismissFailed(String clientRef) =>
      _write(_failedKey, failed..removeWhere((e) => e.clientRef == clientRef));

  Map<String, Product> get _products {
    final raw = _prefs.getString(_catalogKey);
    return _catalog ??= raw == null
        ? {}
        : (jsonDecode(raw) as Map<String, dynamic>).map(
            (token, json) => MapEntry(token, Product.fromJson(json as Map<String, dynamic>)),
          );
  }

  Product? product(String token) => _products[token];
  int get catalogSize => _products.length;
  DateTime? get catalogUpdatedAt {
    final raw = _prefs.getString(_catalogAtKey);
    return raw == null ? null : DateTime.parse(raw);
  }

  Future<void> saveCatalog(Map<String, Product> products, {DateTime? at}) async {
    _catalog = products;
    await _prefs.setString(
      _catalogKey,
      jsonEncode(products.map((token, p) => MapEntry(token, p.toJson()))),
    );
    await _prefs.setString(_catalogAtKey, (at ?? DateTime.now()).toUtc().toIso8601String());
    notifyListeners();
  }

  /// Data barang terbaru dari scan online / transaksi terkirim.
  Future<void> rememberProduct(String token, Product product) async {
    final known = _products[token];
    // Tidak berubah: tidak perlu menulis ulang seluruh daftar (ribuan barang).
    if (known != null && jsonEncode(known.toJson()) == jsonEncode(product.toJson())) return;
    final products = Map.of(_products)..[token] = product;
    _catalog = products;
    await _prefs.setString(
      _catalogKey,
      jsonEncode(products.map((t, p) => MapEntry(t, p.toJson()))),
    );
  }

  /// Perkiraan stok = stok terakhir yang diketahui HP ± transaksi yang belum terkirim.
  num estimatedStock(String token, Product product) => roundStock(
    pending.where((e) => e.token == token).fold<num>(product.stock, (s, e) => s + e.delta),
  );
}

/// Hasil pengiriman antrean.
class FlushResult {
  const FlushResult({this.sent = 0, this.failed = 0, this.stopped});
  final int sent;
  final int failed;
  /// null = antrean habis; 'offline' = server belum terjangkau; 'login' = sesi berakhir;
  /// 'busy' = pengiriman lain sedang berjalan.
  final String? stopped;

  String get message => switch (stopped) {
    'offline' => 'Server belum terjangkau. Dicoba lagi otomatis.',
    'login' => 'Sesi berakhir. Login lagi untuk mengirim antrean.',
    'busy' => 'Antrean sedang dikirim…',
    _ => '$sent transaksi offline terkirim.'
        '${failed > 0 ? ' $failed ditolak server, perlu dicek.' : ''}',
  };
}

/// Ringkas: "26/10 09.15".
String shortTime(DateTime value) {
  final t = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(t.day)}/${two(t.month)} ${two(t.hour)}.${two(t.minute)}';
}
