import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../offline.dart';
import '../reservation.dart';
import '../ui.dart';
import '../validators.dart';
import 'quantity_screen.dart';
import 'scan_screen.dart';

/// Barang keluar langkah 1: no reservasi (7 angka). Reservasi baru → isi total item
/// (jumlah jenis barang) sekali. Reservasi yang sudah dimulai → langsung dilanjutkan.
class ReservationStartScreen extends StatefulWidget {
  const ReservationStartScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<ReservationStartScreen> createState() => _ReservationStartScreenState();
}

class _ReservationStartScreenState extends State<ReservationStartScreen> {
  final _form = GlobalKey<FormState>();
  final _number = TextEditingController();
  final _total = TextEditingController();
  // true = reservasi belum ada: minta total item.
  bool _askTotal = false;
  // true = server tidak terjangkau saat memeriksa no reservasi.
  bool _offline = false;
  bool _busy = false;

  ApiClient get api => widget.api;

  @override
  void dispose() {
    _number.dispose();
    _total.dispose();
    super.dispose();
  }

  void _open(ReservationSession session) {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(
        settings: const RouteSettings(name: ReservationScreen.routeName),
        builder: (_) => ReservationScreen(api: api, session: session),
      ),
    );
  }

  /// Sesi dari data terakhir di HP (atau antrean HP) saat server tidak terjangkau.
  ReservationSession? _fromPhone(String number) {
    final cached = api.store.offline.cachedReservation(number);
    if (cached != null) return ReservationSession(api, cached, offline: true);
    final queued = api.store.offline.pending
        .where((q) => q.reservationNumber == number && q.reservationTotal != null)
        .firstOrNull;
    if (queued == null) return null;
    return ReservationSession(
      api,
      Reservation(number: number, total: queued.reservationTotal!, taken: 0, items: []),
      offline: true,
    );
  }

  Future<void> _next() async {
    if (_busy || !_form.currentState!.validate()) return;
    final number = _number.text;
    setState(() => _busy = true);
    try {
      if (!_askTotal) {
        await _check(number);
      } else {
        await _start(number, int.parse(_total.text));
      }
    } on ApiException catch (error) {
      if (!mounted) return;
      if (error.unauthorized) {
        goToLogin(context, api, 'Sesi berakhir. Silakan login lagi.');
        return;
      }
      showError(context, error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Sudah dimulai → lanjutkan; belum → minta total item.
  Future<void> _check(String number) async {
    try {
      final reservation = await api.reservation(number);
      if (!mounted) return;
      if (reservation != null) return _open(ReservationSession(api, reservation));
      setState(() {
        _askTotal = true;
        _offline = false;
      });
    } on ApiException catch (error) {
      if (!error.unavailable) rethrow;
      if (!mounted) return;
      final session = _fromPhone(number);
      if (session != null) return _open(session);
      setState(() {
        _askTotal = true;
        _offline = true;
      });
    }
  }

  Future<void> _start(String number, int total) async {
    if (!_offline) {
      try {
        final reservation = await api.createReservation(number, total);
        if (mounted) _open(ReservationSession(api, reservation));
        return;
      } on ApiException catch (error) {
        if (error.code == 'RESERVATION_EXISTS') {
          // Baru saja dimulai di HP lain: lanjutkan reservasi itu.
          final reservation = await api.reservation(number);
          if (!mounted || reservation == null) return;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'Reservasi $number sudah dimulai (total ${reservation.total} item). Dilanjutkan.',
              ),
            ),
          );
          return _open(ReservationSession(api, reservation));
        }
        if (!error.unavailable) rethrow;
      }
    }
    // Offline: sesi dimulai di HP; server membuatnya saat barang pertama terkirim.
    final local = Reservation(number: number, total: total, taken: 0, items: []);
    await api.store.offline.rememberReservation(local);
    if (mounted) _open(ReservationSession(api, local, offline: true));
  }

  @override
  Widget build(BuildContext context) {
    const color = outBlue;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: color,
        foregroundColor: Colors.white,
        title: const Text('OUT · No Reservasi'),
      ),
      body: SafeArea(
        child: Form(
          key: _form,
          child: Column(
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    if (_askTotal && _offline) ...[const OfflineNotice(), const SizedBox(height: 16)],
                    Text(
                      'Masukkan no reservasi ($reservationLength angka)',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    TextFormField(
                      key: const Key('reservation'),
                      controller: _number,
                      autofocus: true,
                      keyboardType: TextInputType.number,
                      inputFormatters: [
                        ...digitsOnly,
                        LengthLimitingTextInputFormatter(reservationLength),
                      ],
                      maxLength: reservationLength,
                      textAlign: TextAlign.center,
                      textInputAction: TextInputAction.next,
                      style: const TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.bold,
                        fontFamily: 'monospace',
                        letterSpacing: 6,
                      ),
                      decoration: const InputDecoration(hintText: '0000000'),
                      validator: validateReservation,
                      // No reservasi diganti: periksa lagi dari awal.
                      onChanged: (_) {
                        if (_askTotal) setState(() => _askTotal = false);
                      },
                      onFieldSubmitted: (_) => _next(),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Cukup sekali per pengambilan. Reservasi yang belum selesai bisa '
                      'dilanjutkan dengan no reservasi yang sama.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    if (_askTotal) ...[
                      const SizedBox(height: 24),
                      Text(
                        'Reservasi baru. Total item yang akan diambil',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 8),
                      TextFormField(
                        key: const Key('total'),
                        controller: _total,
                        autofocus: true,
                        keyboardType: TextInputType.number,
                        inputFormatters: [...digitsOnly, LengthLimitingTextInputFormatter(3)],
                        textAlign: TextAlign.center,
                        textInputAction: TextInputAction.done,
                        style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
                        decoration: const InputDecoration(hintText: '0', suffixText: 'item'),
                        validator: (value) => validateReservationTotal(value),
                        onFieldSubmitted: (_) => _next(),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Jumlah jenis barang yang berbeda. Setiap barang di-scan sekali, '
                        'lalu isi jumlah yang diambil.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                child: FilledButton(
                  onPressed: _busy ? null : _next,
                  style: FilledButton.styleFrom(
                    backgroundColor: color,
                    minimumSize: const Size.fromHeight(54),
                  ),
                  child: _busy
                      ? const SizedBox.square(
                          dimension: 22,
                          child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                        )
                      : Text(_askTotal ? 'MULAI SCAN' : 'LANJUT'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Barang keluar langkah 2: progres reservasi, scan barang satu per satu sampai
/// semua item terambil. User boleh keluar kapan saja dan melanjutkan nanti.
class ReservationScreen extends StatefulWidget {
  const ReservationScreen({super.key, required this.api, required this.session});

  static const routeName = '/reservation';
  final ApiClient api;
  final ReservationSession session;

  @override
  State<ReservationScreen> createState() => _ReservationScreenState();
}

class _ReservationScreenState extends State<ReservationScreen> with RouteAware {
  ReservationSession get session => widget.session;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route != null) routeObserver.subscribe(this, route);
  }

  /// Kembali dari scan: ambil progres terbaru (barang mungkin juga diambil dari HP lain).
  @override
  void didPopNext() => unawaited(session.refresh().catchError((_) {}));

  @override
  void dispose() {
    routeObserver.unsubscribe(this);
    session.dispose();
    super.dispose();
  }

  void _scan() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        settings: const RouteSettings(name: ScanScreen.routeName),
        builder: (_) => ScanScreen(api: widget.api, mode: Mode.outbound, session: session),
      ),
    );
  }

  Future<void> _changeTotal() async {
    final total = await showDialog<int>(
      context: context,
      builder: (_) => _TotalDialog(current: session.total, min: session.taken),
    );
    if (total == null || total == session.total || !mounted) return;
    try {
      await session.setTotal(total);
    } on ApiException catch (error) {
      if (!mounted) return;
      showError(
        context,
        error.unavailable
            ? 'Mengubah total item butuh koneksi ke server. Coba lagi saat sinyal kembali.'
            : error.message,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: session,
      builder: (context, _) {
        final taken = session.taken;
        final total = session.total;
        final done = session.done;
        final items = session.items;
        final waiting = session.pendingItems.length;
        return Scaffold(
          appBar: AppBar(
            backgroundColor: outBlue,
            foregroundColor: Colors.white,
            title: Text('OUT · ${session.number}'),
          ),
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                if (session.offline || waiting > 0) ...[
                  _Note(
                    waiting > 0
                        ? '$waiting barang tersimpan di HP, dikirim otomatis saat server bisa dihubungi.'
                        : 'Server tidak terjangkau. Progres dari data terakhir di HP.',
                  ),
                  const SizedBox(height: 16),
                ],
                Card(
                  margin: EdgeInsets.zero,
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('No reservasi ${session.number}', style: theme.textTheme.bodyMedium),
                        const SizedBox(height: 6),
                        Text(
                          '$taken dari $total barang',
                          key: const Key('progress'),
                          style: theme.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 10),
                        LinearProgressIndicator(
                          value: total == 0 ? 0 : (taken / total).clamp(0, 1).toDouble(),
                          minHeight: 10,
                          borderRadius: BorderRadius.circular(5),
                          color: done ? brandGreen : const Color(0xFFD97706),
                          backgroundColor: const Color(0xFFE2E8F0),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          done ? 'SELESAI · semua barang sudah diambil' : 'BELUM SELESAI · kurang ${total - taken} barang',
                          key: const Key('status'),
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            color: done ? brandGreen : const Color(0xFFB45309),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                if (!done)
                  FilledButton.icon(
                    key: const Key('scan'),
                    onPressed: _scan,
                    style: FilledButton.styleFrom(
                      backgroundColor: outBlue,
                      minimumSize: const Size.fromHeight(56),
                    ),
                    icon: const Icon(Icons.qr_code_scanner),
                    label: Text('SCAN BARANG (${taken + 1}/$total)'),
                  )
                else
                  FilledButton.icon(
                    onPressed: () => Navigator.of(context).pop(),
                    style: FilledButton.styleFrom(
                      backgroundColor: brandGreen,
                      minimumSize: const Size.fromHeight(56),
                    ),
                    icon: const Icon(Icons.check_circle),
                    label: const Text('SELESAI · kembali ke menu'),
                  ),
                const SizedBox(height: 8),
                TextButton.icon(
                  key: const Key('change-total'),
                  onPressed: _changeTotal,
                  icon: const Icon(Icons.edit_outlined),
                  label: const Text('Ubah total item'),
                ),
                const SizedBox(height: 12),
                Text('Barang yang sudah diambil', style: theme.textTheme.titleMedium),
                const SizedBox(height: 4),
                if (items.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Text('Belum ada barang yang di-scan.'),
                  ),
                for (final (i, item) in items.indexed)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: CircleAvatar(
                      backgroundColor: item.pending ? const Color(0xFFFEF3C7) : const Color(0xFFDBEAFE),
                      child: Text('${i + 1}'),
                    ),
                    title: Text('${item.sku} · ${item.name}', maxLines: 2, overflow: TextOverflow.ellipsis),
                    subtitle: Text(
                      '−${formatQty(item.quantity)} ${item.unit} · ${shortTime(item.scannedAt)}'
                      '${item.pending ? ' · tersimpan di HP' : ''}',
                    ),
                    trailing: Icon(
                      item.pending ? Icons.cloud_upload_outlined : Icons.check,
                      color: item.pending ? const Color(0xFFB45309) : brandGreen,
                    ),
                  ),
                if (!done) ...[
                  const SizedBox(height: 16),
                  OutlinedButton(
                    key: const Key('exit'),
                    onPressed: () => Navigator.of(context).pop(),
                    style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)),
                    child: const Text('Keluar, lanjutkan nanti'),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Status tetap belum selesai. Lanjutkan dengan no reservasi ${session.number}.',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodySmall,
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

class _Note extends StatelessWidget {
  const _Note(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFEF3C7),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFFCD34D)),
      ),
      child: Row(
        children: [
          const Icon(Icons.cloud_off, color: Color(0xFFB45309)),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: const TextStyle(color: Color(0xFF78350F)))),
        ],
      ),
    );
  }
}

/// Ubah total item: minimal sebanyak barang yang sudah diambil.
class _TotalDialog extends StatefulWidget {
  const _TotalDialog({required this.current, required this.min});

  final int current;
  final int min;

  @override
  State<_TotalDialog> createState() => _TotalDialogState();
}

class _TotalDialogState extends State<_TotalDialog> {
  final _form = GlobalKey<FormState>();
  late final _total = TextEditingController(text: '${widget.current}');

  @override
  void dispose() {
    _total.dispose();
    super.dispose();
  }

  void _save() {
    if (_form.currentState!.validate()) Navigator.of(context).pop(int.parse(_total.text));
  }

  @override
  Widget build(BuildContext context) {
    final min = widget.min < 1 ? 1 : widget.min;
    return AlertDialog(
      title: const Text('Ubah total item'),
      content: Form(
        key: _form,
        child: TextFormField(
          key: const Key('new-total'),
          controller: _total,
          autofocus: true,
          keyboardType: TextInputType.number,
          inputFormatters: [...digitsOnly, LengthLimitingTextInputFormatter(3)],
          decoration: InputDecoration(
            suffixText: 'item',
            helperText: 'Minimal $min (barang yang sudah diambil).',
          ),
          validator: (value) => validateReservationTotal(value, min: min),
          onFieldSubmitted: (_) => _save(),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Batal')),
        FilledButton(onPressed: _save, child: const Text('Simpan')),
      ],
    );
  }
}
