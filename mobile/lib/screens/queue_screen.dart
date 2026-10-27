import 'package:flutter/material.dart';

import '../api.dart';
import '../offline.dart';
import '../ui.dart';
import '../validators.dart';

/// Antrean offline: transaksi yang menunggu dikirim dan yang ditolak server.
class QueueScreen extends StatefulWidget {
  const QueueScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<QueueScreen> createState() => _QueueScreenState();
}

class _QueueScreenState extends State<QueueScreen> {
  bool _busy = false;

  OfflineStore get _store => widget.api.store.offline;

  Future<void> _send() async {
    setState(() => _busy = true);
    final result = await widget.api.flushQueue();
    if (!mounted) return;
    setState(() => _busy = false);
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(result.message), behavior: SnackBarBehavior.floating));
  }

  Future<void> _dismiss(QueuedTransaction item) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Hapus dari HP?'),
        content: const Text(
          'Transaksi ini tidak akan tercatat di web. Hapus hanya bila sudah '
          'dicatat dengan cara lain (koreksi stok di web atau buku darurat).',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Batal')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Hapus')),
        ],
      ),
    );
    if (ok == true) await _store.dismissFailed(item.clientRef);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Antrean offline')),
      body: SafeArea(
        child: ListenableBuilder(
          listenable: _store,
          builder: (context, _) {
            final pending = _store.pending;
            final failed = _store.failed;
            if (pending.isEmpty && failed.isEmpty) {
              return const Center(child: Text('Semua transaksi sudah terkirim.'));
            }
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (pending.isNotEmpty) ...[
                  Text('Menunggu dikirim (${pending.length})', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  for (final item in pending) _QueueTile(item: item),
                  const SizedBox(height: 8),
                  FilledButton.icon(
                    onPressed: _busy ? null : _send,
                    icon: const Icon(Icons.cloud_upload),
                    label: Text(_busy ? 'Mengirim…' : 'Kirim sekarang'),
                  ),
                  const SizedBox(height: 24),
                ],
                if (failed.isNotEmpty) ...[
                  Text('Ditolak server — perlu dicek (${failed.length})', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 4),
                  const Text(
                    'Bereskan penyebabnya di web (mis. koreksi stok), lalu kirim ulang. '
                    'Atau hapus bila sudah dicatat dengan cara lain.',
                  ),
                  const SizedBox(height: 8),
                  for (final item in failed)
                    _QueueTile(
                      item: item,
                      failed: true,
                      actions: [
                        TextButton(
                          onPressed: () => _dismiss(item),
                          child: const Text('Hapus'),
                        ),
                        FilledButton.tonal(
                          onPressed: _busy
                              ? null
                              : () async {
                                  await _store.retryFailed(item.clientRef);
                                  await _send();
                                },
                          child: const Text('Kirim ulang'),
                        ),
                      ],
                    ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _QueueTile extends StatelessWidget {
  const _QueueTile({required this.item, this.failed = false, this.actions = const []});

  final QueuedTransaction item;
  final bool failed;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final product = item.product;
    final sign = item.mode == Mode.inbound ? '+' : '−';
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: modeColor(item.mode),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(item.mode.code, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '${product.sku} · ${product.name}',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Jumlah $sign${formatQty(item.quantity)} ${product.unit}'
              '${item.reservationNumber != null ? ' · Reservasi ${item.reservationNumber}' : ''}'
              '${item.inCode != null ? ' · Kode ${item.inCode}' : ''}'
              ' · dicatat ${shortTime(item.recordedAt)}',
            ),
            if (item.lastError != null) ...[
              const SizedBox(height: 4),
              Text(
                failed ? item.lastError! : 'Terakhir: ${item.lastError}',
                style: TextStyle(color: failed ? Colors.red.shade700 : Colors.grey.shade700, fontSize: 13),
              ),
            ],
            if (actions.isNotEmpty)
              Row(mainAxisAlignment: MainAxisAlignment.end, children: actions),
          ],
        ),
      ),
    );
  }
}
