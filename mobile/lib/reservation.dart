import 'package:flutter/foundation.dart';

import 'api.dart';

/// Sesi pengambilan barang untuk satu no reservasi di HP: data terakhir dari server
/// ditambah transaksi sesi ini yang masih di antrean HP (belum terkirim), sehingga
/// progres tetap benar saat server tidak terjangkau.
class ReservationSession extends ChangeNotifier {
  ReservationSession(this.api, Reservation reservation, {this.offline = false})
    : _server = reservation {
    _queued = _queuedCount;
    api.store.offline.addListener(_onQueueChanged);
  }

  final ApiClient api;
  Reservation _server;

  /// true = data terakhir dari HP karena server tidak terjangkau.
  bool offline;

  String get number => _server.number;

  /// Jumlah jenis barang yang harus diambil.
  int get total => _server.total;

  int _queued = 0;
  int get _queuedCount => api.store.offline.pending
      .where((q) => q.reservationNumber == number && q.reservationTotal != null)
      .length;

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
  List<ReservationItem> get pendingItems {
    final known = _server.items.map((e) => e.productId).toSet();
    final items = <ReservationItem>[];
    for (final q in api.store.offline.pending) {
      if (q.reservationNumber != number || q.reservationTotal == null) continue;
      if (!known.add(q.product.id)) continue;
      items.add(
        ReservationItem(
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

  /// Barang yang sudah diambil (tersimpan di server + antrean HP), urut waktu scan.
  List<ReservationItem> get items => [..._server.items, ...pendingItems];

  /// Jumlah jenis barang yang sudah diambil.
  int get taken => _server.taken + pendingItems.length;
  bool get done => taken >= total;

  /// Barang ini sudah diambil untuk reservasi ini (satu barang hanya sekali).
  bool has(int productId) => items.any((e) => e.productId == productId);

  /// Transaksi tersimpan di server: perbarui progres dari jawaban server.
  void applyResult(TransactionResult result) {
    final progress = result.reservation;
    if (progress == null) return;
    final product = result.product;
    _server = Reservation(
      number: progress.number,
      total: progress.total,
      taken: progress.taken,
      items: [
        ..._server.items.where((e) => e.productId != product.id),
        ReservationItem(
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
    api.store.offline.rememberReservation(_server);
    notifyListeners();
  }

  /// Ambil progres terbaru dari server (mis. barang diambil dari HP lain).
  /// Server tidak terjangkau: tetap memakai data di HP.
  Future<void> refresh() async {
    try {
      final latest = await api.reservation(number);
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
    _server = await api.setReservationTotal(number, total);
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
