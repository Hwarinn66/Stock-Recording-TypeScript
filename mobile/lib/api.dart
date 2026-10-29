import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

import 'offline.dart';
import 'session_store.dart';

enum Mode {
  inbound('IN', 'Barang Masuk'),
  outbound('OUT', 'Barang Keluar');

  const Mode(this.code, this.label);
  final String code;
  final String label;
  bool get needsReservation => this == Mode.outbound;
  /// Barang masuk wajib Kode Masuk (111.22.33; barang ATK: ATK.111.22.33).
  bool get needsInCode => this == Mode.inbound;
}

class ApiException implements Exception {
  ApiException(this.message, {this.code, this.status = 0});
  final String message;
  final String? code;
  final int status;
  bool get unauthorized => status == 401;
  /// Server tidak terjangkau / sedang error: transaksi disimpan di HP (antrean offline).
  bool get unavailable => status == 0 || status >= 500;
  @override
  String toString() => message;
}

class Product {
  Product({
    required this.id,
    required this.sku,
    required this.name,
    required this.unit,
    required this.stock,
    required this.locationCode,
    this.minStock = 2,
    this.roomName,
    this.categoryName,
  });

  factory Product.fromJson(Map<String, dynamic> json) => Product(
    id: json['id'] as int,
    sku: json['sku'] as String,
    name: json['name'] as String,
    unit: json['unit'] as String,
    stock: json['stock'] as num,
    // Server lama / data cache lama tanpa min_stock: batas bawaan 2.
    minStock: json['min_stock'] as num? ?? 2,
    locationCode: json['location_code'] as String,
    roomName: json['room_name'] as String?,
    categoryName: json['category_name'] as String?,
  );

  final int id;
  final String sku;
  final String name;
  final String unit;
  final num stock;

  /// Batas stok minimal barang: stok <= minStock = STOK MENIPIS.
  final num minStock;
  final String locationCode;
  final String? roomName;
  final String? categoryName;

  String get place =>
      roomName == null ? locationCode : '$roomName · $locationCode';

  /// Barang kategori ATK: Kode Masuk diawali "ATK.".
  bool get isAtk => (categoryName ?? '').trim().toUpperCase() == 'ATK';

  Map<String, Object?> toJson() => {
    'id': id,
    'sku': sku,
    'name': name,
    'unit': unit,
    'stock': stock,
    'min_stock': minStock,
    'location_code': locationCode,
    'room_name': roomName,
    'category_name': categoryName,
  };
}

/// Riwayat singkat di halaman Cek Barang.
class ProductHistory {
  ProductHistory({
    required this.number,
    required this.type,
    required this.status,
    required this.scannedAt,
    this.quantity,
    this.stockAfter,
    this.reservationNumber,
    this.inCode,
    this.actor,
  });

  factory ProductHistory.fromJson(Map<String, dynamic> json) => ProductHistory(
    number: json['transaction_number'] as String,
    type: json['transaction_type'] as String,
    status: json['status'] as String,
    scannedAt: DateTime.parse('${(json['scanned_at'] as String).replaceFirst(' ', 'T')}Z'),
    quantity: json['quantity'] as num?,
    stockAfter: json['stock_after'] as num?,
    reservationNumber: json['reservation_number'] as String?,
    inCode: json['in_code'] as String?,
    actor: json['actor_name'] as String?,
  );

  final String number;
  final String type; // IN / OUT / ADJUSTMENT
  final String status; // APPROVED / PENDING / CANCELLED
  final DateTime scannedAt;
  final num? quantity;
  final num? stockAfter;
  final String? reservationNumber;
  final String? inCode;
  final String? actor;
}

/// Detail barang untuk halaman Cek Barang.
class ProductInfo {
  ProductInfo({
    required this.product,
    required this.active,
    required this.history,
    required this.in30,
    required this.out30,
    this.movement,
    this.description,
    this.blockCode,
    this.rackNumber,
    this.positionNumber,
    this.pending,
  });

  factory ProductInfo.fromJson(Map<String, dynamic> json) {
    final p = json['product'] as Map<String, dynamic>;
    return ProductInfo(
      product: Product.fromJson(p),
      active: p['active'] == 1 || p['active'] == true,
      movement: p['movement_class'] as String?,
      description: p['description'] as String?,
      blockCode: p['block_code'] as String?,
      rackNumber: p['rack_number'] as int?,
      positionNumber: p['position_number'] as int?,
      pending: json['pending'] as String?,
      in30: json['in_30'] as num,
      out30: json['out_30'] as num,
      history: (json['history'] as List)
          .map((e) => ProductHistory.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  final Product product;
  final bool active;
  final String? movement;
  final String? description;
  final String? blockCode;
  final int? rackNumber;
  final int? positionNumber;
  final String? pending;
  final num in30;
  final num out30;
  final List<ProductHistory> history;
}

class TransactionResult {
  TransactionResult({
    required this.transactionNumber,
    required this.quantity,
    required this.stockBefore,
    required this.stockAfter,
    required this.product,
    this.reservationNumber,
    this.inCode,
    this.replayed = false,
  });

  factory TransactionResult.fromJson(Map<String, dynamic> json) =>
      TransactionResult(
        transactionNumber: json['transaction_number'] as String,
        quantity: json['quantity'] as num,
        stockBefore: json['stock_before'] as num,
        stockAfter: json['stock_after'] as num,
        reservationNumber: json['reservation_number'] as String?,
        inCode: json['in_code'] as String?,
        product: Product.fromJson(json['product'] as Map<String, dynamic>),
        replayed: json['replayed'] as bool? ?? false,
      );

  final String transactionNumber;
  final num quantity;
  final num stockBefore;
  final num stockAfter;
  final String? reservationNumber;
  final String? inCode;
  final Product product;
  /// true = transaksi ini sudah tersimpan sebelumnya (kiriman ulang, tidak dicatat dua kali).
  final bool replayed;
}

/// Klien HTTP yang mempercayai CA sistem + CA mkcert server gudang.
http.Client createHttpClient({List<int>? trustedCertificate}) {
  final context = SecurityContext(withTrustedRoots: true);
  if (trustedCertificate != null) {
    try {
      context.setTrustedCertificatesBytes(trustedCertificate);
    } on TlsException {
      // Sertifikat sudah dipercaya / format tidak valid: tetap pakai CA sistem.
    }
  }
  return IOClient(
    HttpClient(context: context)
      ..connectionTimeout = const Duration(seconds: 10),
  );
}

class ApiClient {
  ApiClient(this.store, this._client);

  final SessionStore store;
  final http.Client _client;
  static const _timeout = Duration(seconds: 20);

  Future<void> login(String username, String password) async {
    await _send('POST', 'auth/login', body: {
      'username': username,
      'password': password,
    });
    await store.setUsername(username);
  }

  Future<String> me() async {
    final data = await _send('GET', 'auth/me') as Map<String, dynamic>;
    return data['username'] as String;
  }

  Future<void> logout() async {
    try {
      await _send('POST', 'auth/logout', body: {});
    } finally {
      await store.clearSession();
    }
  }

  Future<Product> lookup(String token, Mode mode) async {
    final data = await _send(
      'GET',
      'scan/${Uri.encodeComponent(token)}',
      query: {'mode': mode.code},
    );
    final product = Product.fromJson(data as Map<String, dynamic>);
    await store.offline.rememberProduct(token, product);
    return product;
  }

  /// [clientRef] sama untuk kiriman ulang transaksi yang sama (tidak dicatat dua kali).
  /// [recordedAt] hanya untuk antrean offline: waktu barang benar-benar masuk/keluar.
  Future<TransactionResult> record({
    required String token,
    required Mode mode,
    required num quantity,
    String? reservationNumber,
    String? inCode,
    String? clientRef,
    DateTime? recordedAt,
  }) async {
    final data = await _send('POST', 'transactions', body: {
      'qr_token': token,
      'mode': mode.code,
      'quantity': quantity,
      'reservation_number': ?reservationNumber,
      'in_code': ?inCode,
      'client_ref': ?clientRef,
      'recorded_at': ?recordedAt?.toUtc().toIso8601String(),
    });
    final result = TransactionResult.fromJson(data as Map<String, dynamic>);
    await store.offline.rememberProduct(token, result.product);
    return result;
  }

  /// Halaman Cek Barang: detail barang hasil scan (tidak mengubah apa pun).
  Future<ProductInfo> productInfo(String token) async {
    final data = await _send('GET', 'product-info/${Uri.encodeComponent(token)}');
    final info = ProductInfo.fromJson(data as Map<String, dynamic>);
    if (info.active) await store.offline.rememberProduct(token, info.product);
    return info;
  }

  /// Daftar barang aktif (token QR → barang) untuk scan saat server tidak terjangkau.
  Future<Map<String, Product>> catalog() async {
    final data = await _send('GET', 'catalog') as List<dynamic>;
    return {
      for (final item in data.cast<Map<String, dynamic>>())
        item['qr_token'] as String: Product.fromJson(item),
    };
  }

  /// Perbarui daftar barang di HP bila sudah lebih dari [maxAge]. false = gagal (offline).
  Future<bool> refreshCatalog({Duration maxAge = const Duration(minutes: 30)}) async {
    final at = store.offline.catalogUpdatedAt;
    if (at != null && DateTime.now().difference(at) < maxAge) return true;
    try {
      await store.offline.saveCatalog(await catalog());
      return true;
    } on ApiException {
      return false;
    }
  }

  bool _flushing = false;

  /// Kirim antrean offline berurutan (yang lama dulu). Berhenti saat server belum
  /// terjangkau atau sesi habis; yang ditolak server dipindah ke daftar "perlu dicek".
  Future<FlushResult> flushQueue() async {
    if (_flushing) return const FlushResult(stopped: 'busy');
    _flushing = true;
    var sent = 0;
    var failed = 0;
    try {
      for (final item in store.offline.pending) {
        try {
          await record(
            token: item.token,
            mode: item.mode,
            quantity: item.quantity,
            reservationNumber: item.reservationNumber,
            inCode: item.inCode,
            clientRef: item.clientRef,
            recordedAt: item.recordedAt,
          );
          await store.offline.removePending(item.clientRef);
          sent++;
        } on ApiException catch (error) {
          if (error.unauthorized) {
            return FlushResult(sent: sent, failed: failed, stopped: 'login');
          }
          if (error.unavailable) {
            await store.offline.recordAttempt(item.clientRef, error.message);
            return FlushResult(sent: sent, failed: failed, stopped: 'offline');
          }
          await store.offline.moveToFailed(item, error.message);
          failed++;
        }
      }
      return FlushResult(sent: sent, failed: failed);
    } finally {
      _flushing = false;
    }
  }

  Future<Object?> _send(
    String method,
    String path, {
    Map<String, Object?>? body,
    Map<String, String>? query,
  }) async {
    var uri = Uri.parse('${store.serverUrl}/api/$path');
    if (query != null) uri = uri.replace(queryParameters: query);
    final request = http.Request(method, uri)
      ..headers['Accept'] = 'application/json';
    final cookie = store.cookieHeader;
    if (cookie != null) request.headers['Cookie'] = cookie;
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }

    final http.Response response;
    try {
      response = await http.Response.fromStream(
        await _client.send(request).timeout(_timeout),
      );
    } on TimeoutException {
      throw ApiException(
        'Server tidak merespons. Periksa koneksi Wi-Fi lalu coba lagi.',
      );
    } catch (error) {
      throw ApiException(_connectionMessage(error));
    }

    await store.saveCookies(response.headers['set-cookie']);
    final Map<String, dynamic> json;
    try {
      json = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    } catch (_) {
      throw ApiException(
        'Respons server tidak dikenali (HTTP ${response.statusCode}). '
        'Periksa alamat server.',
        status: response.statusCode,
      );
    }
    if (response.statusCode >= 400 || json['success'] != true) {
      if (response.statusCode == 401 && path != 'auth/login') {
        await store.clearSession();
      }
      throw ApiException(
        _errorMessage(json),
        code: json['code'] as String?,
        status: response.statusCode,
      );
    }
    return json['data'];
  }

  String _connectionMessage(Object error) {
    final text = error.toString();
    if (error is HandshakeException ||
        text.contains('CERTIFICATE_VERIFY_FAILED') ||
        text.contains('HandshakeException')) {
      return 'Sertifikat HTTPS server tidak dipercaya. Pastikan alamat server '
          'memakai IP yang terdaftar di sertifikat (mis. 10.185.200.148).';
    }
    return 'Tidak dapat terhubung ke ${store.serverUrl}. Pastikan HP dan '
        'komputer di Wi-Fi yang sama dan server sedang berjalan.';
  }

  /// Untuk error validasi, tampilkan pesan field pertama (lebih spesifik).
  static String _errorMessage(Map<String, dynamic> json) {
    final details = json['details'];
    if (json['code'] == 'VALIDATION_ERROR' && details is Map) {
      final fields = details['fieldErrors'];
      if (fields is Map) {
        for (final messages in fields.values) {
          if (messages is List && messages.isNotEmpty) {
            return messages.first.toString();
          }
        }
      }
    }
    return json['message'] as String? ?? 'Permintaan gagal.';
  }
}
