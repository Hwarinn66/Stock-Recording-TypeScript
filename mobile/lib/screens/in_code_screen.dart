import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../offline.dart';
import '../ui.dart';
import '../validators.dart';
import 'result_screen.dart';

/// Angka saja, titik ditambahkan otomatis: 1112233 → 111.22.33.
class InCodeFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final text = formatInCode(newValue.text);
    return TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
  }
}

/// Langkah 4 (khusus IN): Kode Masuk 111.22.33; barang ATK otomatis diawali "ATK.".
class InCodeScreen extends StatefulWidget {
  const InCodeScreen({
    super.key,
    required this.api,
    required this.mode,
    required this.token,
    required this.product,
    required this.quantity,
    this.offline = false,
  });

  final ApiClient api;
  final Mode mode;
  final String token;
  final Product product;
  final num quantity;
  final bool offline;

  @override
  State<InCodeScreen> createState() => _InCodeScreenState();
}

class _InCodeScreenState extends State<InCodeScreen> {
  final _form = GlobalKey<FormState>();
  final _code = TextEditingController();
  // Satu kunci per transaksi: kirim ulang dari layar ini tidak tercatat dua kali.
  final _clientRef = newClientRef();
  bool _busy = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy || !_form.currentState!.validate()) return;
    setState(() => _busy = true);
    await submitTransaction(
      context,
      api: widget.api,
      mode: widget.mode,
      token: widget.token,
      product: widget.product,
      quantity: widget.quantity,
      inCode: fullInCode(_code.text, atk: widget.product.isAtk),
      clientRef: _clientRef,
      offline: widget.offline,
    );
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final product = widget.product;
    final atk = product.isAtk;
    const codeStyle = TextStyle(
      fontSize: 32,
      fontWeight: FontWeight.bold,
      fontFamily: 'monospace',
      letterSpacing: 3,
    );
    return Scaffold(
      appBar: AppBar(
        backgroundColor: modeColor(widget.mode),
        foregroundColor: Colors.white,
        title: const Text('Kode Masuk'),
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
                    if (widget.offline) ...[const OfflineNotice(), const SizedBox(height: 16)],
                    ProductCard(
                      product: product,
                      stockLabel: widget.offline ? 'Stok terakhir di HP' : 'Stok saat ini',
                      footer: Text(
                        'Jumlah masuk: ${formatQty(widget.quantity)} ${product.unit}',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                      ),
                    ),
                    const SizedBox(height: 24),
                    Text(
                      atk ? 'Masukkan kode masuk (barang ATK)' : 'Masukkan kode masuk',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    TextFormField(
                      key: const Key('in-code'),
                      controller: _code,
                      autofocus: true,
                      keyboardType: TextInputType.number,
                      inputFormatters: [InCodeFormatter()],
                      textAlign: TextAlign.center,
                      textInputAction: TextInputAction.done,
                      style: codeStyle,
                      decoration: InputDecoration(
                        hintText: '111.22.33',
                        // Barang ATK: "ATK." sudah tertulis, petugas cukup mengetik angkanya.
                        prefixText: atk ? 'ATK.' : null,
                        prefixStyle: codeStyle.copyWith(color: brandGreen),
                      ),
                      validator: validateInCode,
                      onFieldSubmitted: (_) => _submit(),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      atk
                          ? 'Format: ATK.111.22.33 — ketik 7 angka, titik terisi otomatis.'
                          : 'Format: 111.22.33 — ketik 7 angka, titik terisi otomatis.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                child: FilledButton(
                  onPressed: _busy ? null : _submit,
                  style: FilledButton.styleFrom(
                    backgroundColor: modeColor(widget.mode),
                    minimumSize: const Size.fromHeight(54),
                  ),
                  child: _busy
                      ? const SizedBox.square(
                          dimension: 22,
                          child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                        )
                      : const Text('SELESAI'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
