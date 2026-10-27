import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../offline.dart';
import '../ui.dart';
import 'queue_screen.dart';
import 'scan_screen.dart';

/// Langkah 1: pilih IN (barang masuk) atau OUT (barang keluar). Selama menu ini
/// ada di tumpukan, antrean offline dikirim otomatis dan daftar barang di HP diperbarui.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  Timer? _timer;
  bool _sending = false;
  bool _needsLogin = false;

  ApiClient get api => widget.api;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_sync());
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _sync());
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_sync());
  }

  /// Kirim antrean (bila ada) lalu perbarui daftar barang untuk scan offline.
  Future<void> _sync({bool manual = false}) async {
    if (_sending) return;
    final store = api.store.offline;
    if (store.pending.isNotEmpty) {
      if (mounted) setState(() => _sending = true);
      final result = await api.flushQueue();
      if (!mounted) return;
      setState(() {
        _sending = false;
        _needsLogin = result.stopped == 'login';
      });
      if (result.sent > 0 || manual) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(result.message), behavior: SnackBarBehavior.floating));
      }
      if (result.stopped != null) return;
    }
    await api.refreshCatalog();
  }

  Future<void> _logout(BuildContext context) async {
    try {
      await api.logout();
    } on ApiException {
      // Sesi lokal tetap dihapus walau server tidak terjangkau.
    }
    if (context.mounted) goToLogin(context, api, 'Anda sudah logout.');
  }

  void _openQueue() => Navigator.of(context).push(
    MaterialPageRoute<void>(builder: (_) => QueueScreen(api: api)),
  );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final store = api.store.offline;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Warehouse Scanner'),
        actions: [
          IconButton(
            tooltip: 'Antrean offline',
            icon: const Icon(Icons.cloud_queue),
            onPressed: _openQueue,
          ),
          IconButton(
            tooltip: 'Logout',
            icon: const Icon(Icons.logout),
            onPressed: () => _logout(context),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: ListenableBuilder(
            listenable: store,
            builder: (context, _) {
              final pending = store.pending;
              final failed = store.failed;
              final updated = store.catalogUpdatedAt;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'Pilih jenis transaksi',
                    style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Login sebagai ${api.store.username ?? '-'}',
                    style: theme.textTheme.bodyMedium,
                  ),
                  if (pending.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    _Banner(
                      key: const Key('pending-banner'),
                      color: const Color(0xFFFEF3C7),
                      border: const Color(0xFFFCD34D),
                      icon: Icons.cloud_upload_outlined,
                      title: '${pending.length} transaksi tersimpan di HP, belum terkirim',
                      subtitle: _needsLogin
                          ? 'Sesi berakhir. Logout lalu login lagi untuk mengirimnya.'
                          : 'Dikirim otomatis saat server bisa dihubungi.',
                      action: _sending ? 'Mengirim…' : 'Kirim sekarang',
                      onAction: _sending ? null : () => _sync(manual: true),
                      onTap: _openQueue,
                    ),
                  ],
                  if (failed.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    _Banner(
                      key: const Key('failed-banner'),
                      color: const Color(0xFFFEE2E2),
                      border: const Color(0xFFFCA5A5),
                      icon: Icons.error_outline,
                      title: '${failed.length} transaksi ditolak server',
                      subtitle: 'Perlu dicek, mis. stok tidak mencukupi.',
                      action: 'Lihat',
                      onAction: _openQueue,
                      onTap: _openQueue,
                    ),
                  ],
                  const SizedBox(height: 20),
                  Expanded(
                    child: _ModeButton(
                      mode: Mode.inbound,
                      icon: Icons.south,
                      subtitle: 'Scan barang lalu isi jumlah yang masuk',
                      onTap: () => _open(context, Mode.inbound),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Expanded(
                    child: _ModeButton(
                      mode: Mode.outbound,
                      icon: Icons.north,
                      subtitle: 'Scan barang, isi jumlah, lalu no reservasi',
                      onTap: () => _open(context, Mode.outbound),
                    ),
                  ),
                  const SizedBox(height: 16),
                  // Cek Barang: scan untuk melihat detail barang (tidak mengubah stok).
                  OutlinedButton.icon(
                    key: const Key('info-button'),
                    onPressed: () => _open(context, null),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: infoColor,
                      minimumSize: const Size.fromHeight(56),
                      side: const BorderSide(color: infoColor, width: 1.5),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    ),
                    icon: const Icon(Icons.manage_search),
                    label: const Text(
                      'CEK BARANG · lihat detail barang',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    updated == null
                        ? 'Data barang belum tersimpan di HP (dibutuhkan untuk scan saat server mati).'
                        : 'Data barang di HP: ${store.catalogSize} barang · diperbarui ${shortTime(updated)}',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodySmall,
                  ),
                  Text(
                    api.store.serverUrl,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodySmall,
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  void _open(BuildContext context, Mode? mode) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        settings: const RouteSettings(name: ScanScreen.routeName),
        builder: (_) => ScanScreen(api: api, mode: mode),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({
    super.key,
    required this.color,
    required this.border,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.action,
    required this.onAction,
    required this.onTap,
  });

  final Color color;
  final Color border;
  final IconData icon;
  final String title;
  final String subtitle;
  final String action;
  final VoidCallback? onAction;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
          child: Row(
            children: [
              Icon(icon),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
                    Text(subtitle, style: const TextStyle(fontSize: 13)),
                  ],
                ),
              ),
              TextButton(onPressed: onAction, child: Text(action)),
            ],
          ),
        ),
      ),
    );
  }
}

class _ModeButton extends StatelessWidget {
  const _ModeButton({
    required this.mode,
    required this.icon,
    required this.subtitle,
    required this.onTap,
  });

  final Mode mode;
  final IconData icon;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = modeColor(mode);
    return Material(
      color: color,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(24),
          // Mengecil bila ruang sempit (HP kecil, atau banner antrean sedang tampil).
          child: FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, color: Colors.white, size: 40),
                const SizedBox(height: 12),
                Text(
                  '${mode.code} · ${mode.label}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 26,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 6),
                Text(subtitle, style: const TextStyle(color: Colors.white70, fontSize: 15)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
