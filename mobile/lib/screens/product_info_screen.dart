import 'package:flutter/material.dart';

import '../api.dart';
import '../offline.dart';
import '../ui.dart';
import '../validators.dart';

/// Halaman Cek Barang: detail barang hasil scan. Hanya melihat, tidak mengubah stok.
class ProductInfoScreen extends StatelessWidget {
  const ProductInfoScreen({super.key, required ProductInfo this.info}) : cached = null;

  /// Server tidak terjangkau: data terakhir yang tersimpan di HP (tanpa riwayat).
  const ProductInfoScreen.offline({super.key, required Product product})
    : info = null,
      cached = product;

  final ProductInfo? info;
  final Product? cached;

  /// Menipis = stok sampai batas minimal barang itu, habis = 0.
  static String stockStatus(num stock, [num minStock = 2]) =>
      stock == 0 ? 'STOK HABIS' : (stock <= minStock ? 'STOK MENIPIS' : 'AMAN');

  static String movementLabel(String? m) => switch (m) {
    'FAST' => 'Fast moving',
    'SLOW' => 'Slow moving',
    'DEAD' => 'Dead stock',
    _ => 'Belum diberi label',
  };

  @override
  Widget build(BuildContext context) {
    final info = this.info;
    final p = info?.product ?? cached!;
    final theme = Theme.of(context);
    final status = stockStatus(p.stock, p.minStock);
    final statusColor = switch (status) {
      'STOK HABIS' => Colors.red.shade700,
      'STOK MENIPIS' => Colors.orange.shade800,
      _ => brandGreen,
    };
    final location = [
      if (info?.blockCode != null) 'Blok ${info!.blockCode}',
      if (info?.rackNumber != null) 'Rak ${info!.rackNumber.toString().padLeft(2, '0')}',
      if (info?.positionNumber != null) 'Posisi ${info!.positionNumber}',
    ].join(' · ');
    final rows = <(String, String)>[
      if (p.categoryName != null) ('Kategori', p.categoryName!),
      ('Satuan', p.unit),
      ('Stok minimal', '${formatQty(p.minStock)} ${p.unit}'),
      ('Ruangan', p.roomName ?? '—'),
      ('Lokasi', p.locationCode),
      if (location.isNotEmpty) ('Blok / Rak', location),
      if (info?.description?.trim().isNotEmpty ?? false) ('Keterangan', info!.description!.trim()),
    ];
    return Scaffold(
      appBar: AppBar(
        backgroundColor: infoColor,
        foregroundColor: Colors.white,
        title: const Text('Detail Barang'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (info == null) ...[
              const _Notice(
                icon: Icons.cloud_off,
                text: 'Server tidak terjangkau. Ini data terakhir yang tersimpan di HP; '
                    'riwayat transaksi tidak tersedia.',
              ),
              const SizedBox(height: 12),
            ],
            Card(
              margin: EdgeInsets.zero,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(p.name, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    Text('KODE BARANG', style: theme.textTheme.labelSmall),
                    Text(
                      p.sku,
                      key: const Key('info-sku'),
                      style: const TextStyle(fontFamily: 'monospace', fontSize: 26, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 12),
                    Text(info == null ? 'STOK TERAKHIR DI HP' : 'STOK SAAT INI', style: theme.textTheme.labelSmall),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.baseline,
                      textBaseline: TextBaseline.alphabetic,
                      children: [
                        Text(
                          formatQty(p.stock),
                          key: const Key('info-stock'),
                          style: TextStyle(fontSize: 40, fontWeight: FontWeight.bold, color: statusColor),
                        ),
                        const SizedBox(width: 6),
                        Text(p.unit, style: const TextStyle(fontSize: 18)),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        _Chip(status, statusColor),
                        if (info != null) _Chip(movementLabel(info.movement), infoColor),
                        if (info != null && !info.active) _Chip('NONAKTIF', Colors.grey.shade700),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            if (info?.pending != null) ...[
              const SizedBox(height: 12),
              _Notice(
                icon: Icons.hourglass_top,
                text: 'Ada transaksi menunggu proses (${info!.pending}). '
                    'Selesaikan di Dashboard web sebelum scan IN/OUT.',
              ),
            ],
            const SizedBox(height: 12),
            Card(
              margin: EdgeInsets.zero,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Column(
                  children: [
                    for (final (label, value) in rows)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(width: 100, child: Text(label, style: theme.textTheme.bodyMedium)),
                            Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w600))),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
            if (info != null) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: _Total('Masuk 30 hari', '+${formatQty(info.in30)} ${p.unit}', brandGreen)),
                  const SizedBox(width: 12),
                  Expanded(child: _Total('Keluar 30 hari', '−${formatQty(info.out30)} ${p.unit}', outBlue)),
                ],
              ),
              const SizedBox(height: 20),
              Text('Riwayat terakhir', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              if (info.history.isEmpty) const Text('Belum ada transaksi untuk barang ini.'),
              for (final h in info.history) _HistoryTile(h, unit: p.unit),
            ],
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: () => Navigator.of(context).pop(),
              style: FilledButton.styleFrom(backgroundColor: infoColor, minimumSize: const Size.fromHeight(54)),
              icon: const Icon(Icons.qr_code_scanner),
              label: const Text('SCAN BARANG LAIN'),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () => Navigator.of(context).popUntil((route) => route.isFirst),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)),
              child: const Text('Kembali ke menu'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip(this.text, this.color);
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.1),
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: color.withValues(alpha: 0.4)),
    ),
    child: Text(text, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 12)),
  );
}

class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: const Color(0xFFFEF3C7),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: const Color(0xFFFCD34D)),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: const Color(0xFFB45309)),
        const SizedBox(width: 10),
        Expanded(child: Text(text, style: const TextStyle(color: Color(0xFF78350F)))),
      ],
    ),
  );
}

class _Total extends StatelessWidget {
  const _Total(this.label, this.value, this.color);
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) => Card(
    margin: EdgeInsets.zero,
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.labelMedium),
          const SizedBox(height: 4),
          Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: color)),
        ],
      ),
    ),
  );
}

class _HistoryTile extends StatelessWidget {
  const _HistoryTile(this.h, {required this.unit});
  final ProductHistory h;
  final String unit;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (h.type) {
      'IN' => ('Masuk', brandGreen),
      'OUT' => ('Keluar', outBlue),
      _ => ('Koreksi', const Color(0xFF6D28D9)),
    };
    final q = h.quantity;
    final change = q == null
        ? '—'
        : h.type == 'IN'
        ? '+${formatQty(q)}'
        : h.type == 'OUT'
        ? '−${formatQty(q)}'
        : (q > 0 ? '+${formatQty(q)}' : '−${formatQty(-q)}');
    final details = [
      shortTime(h.scannedAt),
      h.number,
      if (h.reservationNumber != null) 'Reservasi ${h.reservationNumber}',
      if (h.inCode != null) 'Kode ${h.inCode}',
      if (h.actor != null) h.actor!,
      if (h.status == 'CANCELLED') 'Dibatalkan',
      if (h.status == 'PENDING') 'Menunggu',
    ].join(' · ');
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: _Chip(label, color),
        title: Text('$change $unit', style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text(details),
        trailing: h.stockAfter == null
            ? null
            : Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  const Text('Stok', style: TextStyle(fontSize: 11)),
                  Text(formatQty(h.stockAfter!), style: const TextStyle(fontWeight: FontWeight.bold)),
                ],
              ),
      ),
    );
  }
}
