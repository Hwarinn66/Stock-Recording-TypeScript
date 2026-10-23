import 'package:flutter/material.dart';

import '../api.dart';
import '../ui.dart';
import 'scan_screen.dart';

/// Langkah 1: pilih IN (barang masuk) atau OUT (barang keluar).
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, required this.api});

  final ApiClient api;

  Future<void> _logout(BuildContext context) async {
    try {
      await api.logout();
    } on ApiException {
      // Sesi lokal tetap dihapus walau server tidak terjangkau.
    }
    if (context.mounted) goToLogin(context, api, 'Anda sudah logout.');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Warehouse Scanner'),
        actions: [
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
          child: Column(
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
              const SizedBox(height: 24),
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
              Text(
                api.store.serverUrl,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _open(BuildContext context, Mode mode) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        settings: const RouteSettings(name: ScanScreen.routeName),
        builder: (_) => ScanScreen(api: api, mode: mode),
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
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
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
    );
  }
}
