import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../offline.dart';
import '../scan_session.dart';
import '../ui.dart';
import '../validators.dart';
import 'in_code_screen.dart';
import 'quantity_screen.dart';
import 'scan_screen.dart';

/// Langkah 1 barang keluar / masuk: kode sekali di awal (OUT: no reservasi 7 angka; IN:
/// kode masuk 111.22.33, pilih ATK atau bukan). Kode baru → isi total item (jumlah jenis
/// barang). Kode yang sudah dimulai → langsung dilanjutkan.
class SessionStartScreen extends StatefulWidget {
  const SessionStartScreen({super.key, required this.api, required this.mode});

  final ApiClient api;
  final Mode mode;

  @override
  State<SessionStartScreen> createState() => _SessionStartScreenState();
}

class _SessionStartScreenState extends State<SessionStartScreen> {
  final _form = GlobalKey<FormState>();
  final _code = TextEditingController();
  final _total = TextEditingController();
  // Barang masuk: kode masuk ATK (ATK.111.22.33) atau bukan ATK (111.22.33).
  bool _atk = false;
  // true = kode belum dimulai: minta total item.
  bool _askTotal = false;
  // true = server tidak terjangkau saat memeriksa kode.
  bool _offline = false;
  bool _busy = false;

  ApiClient get api => widget.api;
  Mode get mode => widget.mode;
  bool get _inbound => mode == Mode.inbound;

  /// Kode lengkap yang dikirim ke server.
  String get _fullCode => _inbound ? fullInCode(_code.text, atk: _atk) : _code.text;

  @override
  void dispose() {
    _code.dispose();
    _total.dispose();
    super.dispose();
  }

  void _open(ScanSession session) {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(
        settings: const RouteSettings(name: SessionScreen.routeName),
        builder: (_) => SessionScreen(api: api, session: session),
      ),
    );
  }

  ScanSession _session(SessionInfo info, {bool offline = false}) =>
      ScanSession(api, info, mode: mode, offline: offline);

  /// Sesi dari data terakhir di HP (atau antrean HP) saat server tidak terjangkau.
  ScanSession? _fromPhone(String code) {
    final cached = api.store.offline.cachedSession(mode, code);
    if (cached != null) return _session(cached, offline: true);
    final queued = api.store.offline.pending
        .where(
          (q) => _inbound
              ? q.mode == Mode.inbound && q.inCode == code && q.receiptTotal != null
              : q.mode == Mode.outbound && q.reservationNumber == code && q.reservationTotal != null,
        )
        .firstOrNull;
    if (queued == null) return null;
    final total = (_inbound ? queued.receiptTotal : queued.reservationTotal)!;
    return _session(SessionInfo(code: code, total: total, taken: 0, items: []), offline: true);
  }

  void _restart() {
    if (_askTotal) setState(() => _askTotal = false);
  }

  Future<void> _next() async {
    if (_busy || !_form.currentState!.validate()) return;
    final code = _fullCode;
    setState(() => _busy = true);
    try {
      if (!_askTotal) {
        await _check(code);
      } else {
        await _start(code, int.parse(_total.text));
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
  Future<void> _check(String code) async {
    try {
      final info = await api.session(mode, code);
      if (!mounted) return;
      if (info != null) return _open(_session(info));
      setState(() {
        _askTotal = true;
        _offline = false;
      });
    } on ApiException catch (error) {
      if (!error.unavailable) rethrow;
      if (!mounted) return;
      final session = _fromPhone(code);
      if (session != null) return _open(session);
      setState(() {
        _askTotal = true;
        _offline = true;
      });
    }
  }

  Future<void> _start(String code, int total) async {
    if (!_offline) {
      try {
        final info = await api.createSession(mode, code, total);
        if (mounted) _open(_session(info));
        return;
      } on ApiException catch (error) {
        if (error.code == '${mode.sessionError}_EXISTS') {
          // Baru saja dimulai di HP lain: lanjutkan sesi itu.
          final info = await api.session(mode, code);
          if (!mounted || info == null) return;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                '${mode.sessionLabel} $code sudah dimulai (total ${info.total} item). Dilanjutkan.',
              ),
            ),
          );
          return _open(_session(info));
        }
        if (!error.unavailable) rethrow;
      }
    }
    // Offline: sesi dimulai di HP; server membuatnya saat barang pertama terkirim.
    final local = SessionInfo(code: code, total: total, taken: 0, items: []);
    await api.store.offline.rememberSession(mode, local);
    if (mounted) _open(_session(local, offline: true));
  }

  @override
  Widget build(BuildContext context) {
    final color = modeColor(mode);
    final theme = Theme.of(context);
    const codeStyle = TextStyle(
      fontSize: 32,
      fontWeight: FontWeight.bold,
      fontFamily: 'monospace',
      letterSpacing: 3,
    );
    return Scaffold(
      appBar: AppBar(
        backgroundColor: color,
        foregroundColor: Colors.white,
        title: Text('${mode.code} · ${_inbound ? 'Kode Masuk' : 'No Reservasi'}'),
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
                    if (_inbound) ...[
                      Text('Jenis barang', style: theme.textTheme.titleMedium),
                      const SizedBox(height: 8),
                      // Kode masuk ATK dan bukan ATK dipisah, sama seperti di ERP.
                      SegmentedButton<bool>(
                        key: const Key('atk'),
                        segments: const [
                          ButtonSegment(value: false, label: Text('Bukan ATK')),
                          ButtonSegment(value: true, label: Text('ATK')),
                        ],
                        selected: {_atk},
                        onSelectionChanged: (value) {
                          setState(() => _atk = value.first);
                          _restart();
                        },
                      ),
                      const SizedBox(height: 20),
                      Text('Masukkan kode masuk', style: theme.textTheme.titleMedium),
                      const SizedBox(height: 8),
                      TextFormField(
                        key: const Key('in-code'),
                        controller: _code,
                        autofocus: true,
                        keyboardType: TextInputType.number,
                        inputFormatters: [InCodeFormatter()],
                        textAlign: TextAlign.center,
                        textInputAction: TextInputAction.next,
                        style: codeStyle,
                        decoration: InputDecoration(
                          hintText: '111.22.33',
                          prefixText: _atk ? 'ATK.' : null,
                          prefixStyle: codeStyle.copyWith(color: color),
                        ),
                        validator: validateInCode,
                        onChanged: (_) => _restart(),
                        onFieldSubmitted: (_) => _next(),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${_atk ? 'Format: ATK.111.22.33, hanya barang ATK.' : 'Format: 111.22.33, hanya barang bukan ATK.'} '
                        'Ketik 7 angka, titik terisi otomatis. Penerimaan yang belum selesai '
                        'bisa dilanjutkan dengan kode masuk yang sama.',
                        style: theme.textTheme.bodySmall,
                      ),
                    ] else ...[
                      Text(
                        'Masukkan no reservasi ($reservationLength angka)',
                        style: theme.textTheme.titleMedium,
                      ),
                      const SizedBox(height: 8),
                      TextFormField(
                        key: const Key('reservation'),
                        controller: _code,
                        autofocus: true,
                        keyboardType: TextInputType.number,
                        inputFormatters: [
                          ...digitsOnly,
                          LengthLimitingTextInputFormatter(reservationLength),
                        ],
                        maxLength: reservationLength,
                        textAlign: TextAlign.center,
                        textInputAction: TextInputAction.next,
                        style: codeStyle.copyWith(letterSpacing: 6),
                        decoration: const InputDecoration(hintText: '0000000'),
                        validator: validateReservation,
                        // No reservasi diganti: periksa lagi dari awal.
                        onChanged: (_) => _restart(),
                        onFieldSubmitted: (_) => _next(),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Cukup sekali per pengambilan. Reservasi yang belum selesai bisa '
                        'dilanjutkan dengan no reservasi yang sama.',
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                    if (_askTotal) ...[
                      const SizedBox(height: 24),
                      Text(
                        _inbound
                            ? 'Kode masuk baru. Total item yang masuk'
                            : 'Reservasi baru. Total item yang akan diambil',
                        style: theme.textTheme.titleMedium,
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
                        'lalu isi jumlah yang ${_inbound ? 'masuk' : 'diambil'}.',
                        style: theme.textTheme.bodySmall,
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

/// Langkah 2: progres sesi, scan barang satu per satu sampai semua item tercatat.
/// User boleh keluar kapan saja dan melanjutkan nanti dengan kode yang sama.
class SessionScreen extends StatefulWidget {
  const SessionScreen({super.key, required this.api, required this.session});

  static const routeName = '/session';
  final ApiClient api;
  final ScanSession session;

  @override
  State<SessionScreen> createState() => _SessionScreenState();
}

class _SessionScreenState extends State<SessionScreen> with RouteAware {
  ScanSession get session => widget.session;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route != null) routeObserver.subscribe(this, route);
  }

  /// Kembali dari scan: ambil progres terbaru (barang mungkin juga dari HP lain).
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
        builder: (_) => ScanScreen(api: widget.api, mode: session.mode, session: session),
      ),
    );
  }

  Future<void> _changeTotal() async {
    final total = await showDialog<int>(
      context: context,
      builder: (_) => _TotalDialog(current: session.total, min: session.taken, verb: session.mode.sessionVerb),
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
    final mode = session.mode;
    final color = modeColor(mode);
    final sign = mode == Mode.inbound ? '+' : '−';
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
            backgroundColor: color,
            foregroundColor: Colors.white,
            title: Text('${mode.code} · ${session.code}'),
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
                        Text(
                          '${mode.sessionCodeLabel} ${session.code}'
                          '${mode == Mode.inbound ? (session.atk ? ' · barang ATK' : ' · barang bukan ATK') : ''}',
                          style: theme.textTheme.bodyMedium,
                        ),
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
                          done
                              ? 'SELESAI · semua barang sudah ${mode.sessionVerb}'
                              : 'BELUM SELESAI · kurang ${total - taken} barang',
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
                      backgroundColor: color,
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
                Text('Barang yang sudah ${mode.sessionVerb}', style: theme.textTheme.titleMedium),
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
                      backgroundColor: item.pending
                          ? const Color(0xFFFEF3C7)
                          : (mode == Mode.inbound ? const Color(0xFFDCFCE7) : const Color(0xFFDBEAFE)),
                      child: Text('${i + 1}'),
                    ),
                    title: Text('${item.sku} · ${item.name}', maxLines: 2, overflow: TextOverflow.ellipsis),
                    subtitle: Text(
                      '$sign${formatQty(item.quantity)} ${item.unit} · ${shortTime(item.scannedAt)}'
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
                    'Status tetap belum selesai. Lanjutkan dengan '
                    '${mode.sessionCodeLabel.toLowerCase()} ${session.code}.',
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

/// Ubah total item: minimal sebanyak barang yang sudah tercatat.
class _TotalDialog extends StatefulWidget {
  const _TotalDialog({required this.current, required this.min, required this.verb});

  final int current;
  final int min;
  final String verb;

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
            helperText: 'Minimal $min (barang yang sudah ${widget.verb}).',
          ),
          validator: (value) => validateReservationTotal(value, min: min, verb: widget.verb),
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
