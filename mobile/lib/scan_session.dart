import 'package:flutter/foundation.dart';

import 'api.dart';
import 'offline.dart';

/// Sesi scan di HP: barang keluar per no reservasi, atau barang masuk per kode masuk.
/// Data terakhir dari server ditambah transaksi sesi ini yang masih di antrean HP (belum
/// terkirim), sehingga progres tetap benar saat server tidak terjangkau.
class ScanSession extends ChangeNotifier {
  ScanSession(this.api, SessionInfo info, {required this.mode, this.offline = false}) : _server = info {
    _queued = _queuedCount;
    api.store.offline.addListener(_onQueueChanged);
  }

  final ApiClient api;
  final Mode mode;
  SessionInfo _server;

  /// true = data terakhir dari HP karena server tidak terjangkau.
  bool offline;

  /// No reservasi (barang keluar) / kode masuk (barang masuk).
  String get code => _server.code;

  /// Kode masuk ATK (ATK.111.22.33): hanya untuk barang ATK; kode lain hanya barang bukan ATK.
  bool get atk => code.startsWith('ATK.');

  /// Jumlah jenis barang yang harus diambil / masuk.
  int get total => _server.total;

  /// Transaksi sesi ini di antrean HP.
  bool _inSession(QueuedTransaction q) => mode == Mode.outbound
      ? q.mode == Mode.outbound && q.reservationNumber == code && q.reservationTotal != null
      : q.mode == Mode.inbound && q.inCode == code && q.receiptTotal != null;

  int _queued = 0;
  int get _queuedCount => api.store.offline.pending.where(_inSession).length;

  /// Antrean berubah. Transaksi sesi ini terkirim (keluar dari antrean) → ambil
  /// progres dari server agar barang itu tetap terhitung.
  void _onQueueChanged() {
    final queued = _queuedCount;
    final sent = queued < _queued;
    _queued = queued;
    notifyListeners();
    if (sent) refresh().catchError((_) {});
  }

  /// Barang sesi ini di antrean HP yang belum ada di data server.
  List<SessionItem> get pendingItems {
    final known = _server.items.map((e) => e.productId).toSet();
    final items = <SessionItem>[];
    for (final q in api.store.offline.pending.where(_inSession)) {
      if (!known.add(q.product.id)) continue;
      items.add(
        SessionItem(
          productId: q.product.id,
          sku: q.product.sku,
          name: q.product.name,
          unit: q.product.unit,
          quantity: q.quantity,
          scannedAt: q.recordedAt,
          pending: true,
        ),
      );
    }
    return items;
  }

  /// Barang yang sudah diambil / masuk (tersimpan di server + antrean HP), urut waktu scan.
  List<SessionItem> get items => [..._server.items, ...pendingItems];

  /// Jumlah jenis barang yang sudah diambil / masuk.
  int get taken => _server.taken + pendingItems.length;
  bool get done => taken >= total;

  /// Barang ini sudah tercatat di sesi ini (satu barang hanya sekali).
  bool has(int productId) => items.any((e) => e.productId == productId);

  /// Alasan barang hasil scan ditolak di sesi ini (server juga menolaknya); null = boleh.
  String? reject(Product product) {
    if (has(product.id)) {
      return 'Barang ${product.sku} sudah ${mode.sessionVerb} untuk '
          '${mode.sessionLabel.toLowerCase()} $code. Scan barang lain.';
    }
    // Kode masuk ATK hanya untuk barang ATK, kode lain hanya barang bukan ATK.
    if (mode == Mode.inbound && product.isAtk != atk) {
      return product.isAtk
          ? 'Barang ${product.sku} adalah barang ATK. Kode masuk $code untuk barang '
                'bukan ATK; scan barang lain atau mulai kode masuk ATK.'
          : 'Barang ${product.sku} bukan barang ATK. Kode masuk $code hanya untuk '
                'barang ATK; scan barang lain atau mulai kode masuk bukan ATK.';
    }
    return null;
  }

  /// Transaksi tersimpan di server: perbarui progres dari jawaban server.
  void applyResult(TransactionResult result) {
    final progress = result.session;
    if (progress == null) return;
    final product = result.product;
    _server = SessionInfo(
      code: progress.code,
      total: progress.total,
      taken: progress.taken,
      items: [
        ..._server.items.where((e) => e.productId != product.id),
        SessionItem(
          productId: product.id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          quantity: result.quantity,
          scannedAt: DateTime.now(),
          transactionNumber: result.transactionNumber,
        ),
      ],
    );
    offline = false;
    api.store.offline.rememberSession(mode, _server);
    notifyListeners();
  }

  /// Ambil progres terbaru dari server (mis. barang dari HP lain).
  /// Server tidak terjangkau: tetap memakai data di HP.
  Future<void> refresh() async {
    try {
      final latest = await api.session(mode, code);
      if (latest != null) _server = latest;
      offline = false;
    } on ApiException catch (error) {
      if (!error.unavailable) rethrow;
      offline = true;
    }
    notifyListeners();
  }

  /// Ubah total item (butuh koneksi ke server).
  Future<void> setTotal(int total) async {
    _server = await api.setSessionTotal(mode, code, total);
    offline = false;
    notifyListeners();
  }

  bool _disposed = false;

  /// Hasil server bisa datang setelah layar sesi ditutup: jangan beri tahu yang sudah dibuang.
  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    api.store.offline.removeListener(_onQueueChanged);
    super.dispose();
  }
}
