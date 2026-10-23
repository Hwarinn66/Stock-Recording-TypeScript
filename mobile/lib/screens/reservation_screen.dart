import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../ui.dart';
import '../validators.dart';
import 'quantity_screen.dart';
import 'result_screen.dart';

/// Langkah 4 (khusus OUT): no reservasi 7 angka = identitas pengambilan & divisi.
class ReservationScreen extends StatefulWidget {
  const ReservationScreen({
    super.key,
    required this.api,
    required this.mode,
    required this.token,
    required this.product,
    required this.quantity,
  });

  final ApiClient api;
  final Mode mode;
  final String token;
  final Product product;
  final num quantity;

  @override
  State<ReservationScreen> createState() => _ReservationScreenState();
}

class _ReservationScreenState extends State<ReservationScreen> {
  final _form = GlobalKey<FormState>();
  final _reservation = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _reservation.dispose();
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
      quantity: widget.quantity,
      reservationNumber: _reservation.text,
    );
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final product = widget.product;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: modeColor(widget.mode),
        foregroundColor: Colors.white,
        title: const Text('No Reservasi'),
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
                    ProductCard(
                      product: product,
                      footer: Text(
                        'Jumlah keluar: ${formatQty(widget.quantity)} ${product.unit}',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                      ),
                    ),
                    const SizedBox(height: 24),
                    Text(
                      'Masukkan no reservasi ($reservationLength angka)',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    TextFormField(
                      key: const Key('reservation'),
                      controller: _reservation,
                      autofocus: true,
                      keyboardType: TextInputType.number,
                      inputFormatters: [
                        ...digitsOnly,
                        LengthLimitingTextInputFormatter(reservationLength),
                      ],
                      maxLength: reservationLength,
                      textAlign: TextAlign.center,
                      textInputAction: TextInputAction.done,
                      style: const TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.bold,
                        fontFamily: 'monospace',
                        letterSpacing: 6,
                      ),
                      decoration: const InputDecoration(hintText: '0000000'),
                      validator: validateReservation,
                      onFieldSubmitted: (_) => _submit(),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'No reservasi menjadi identitas pengambilan dan divisi '
                      'yang mengambil barang.',
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
