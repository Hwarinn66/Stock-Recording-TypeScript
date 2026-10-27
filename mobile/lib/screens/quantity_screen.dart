import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../offline.dart';
import '../ui.dart';
import '../validators.dart';
import 'reservation_screen.dart';
import 'result_screen.dart';

/// Keyboard angka saja; formatter juga menolak huruf dari paste/keyboard fisik.
final digitsOnly = <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly];

/// Satuan Kg: angka dengan satu koma/titik, maks. 3 angka di belakang koma.
class DecimalInputFormatter extends TextInputFormatter {
  static final _pattern = RegExp(r'^\d{0,10}([.,]\d{0,3})?$');

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) => _pattern.hasMatch(newValue.text) ? newValue : oldValue;
}

/// Langkah 3: isi jumlah barang. IN langsung selesai, OUT lanjut ke no reservasi.
class QuantityScreen extends StatefulWidget {
  const QuantityScreen({
    super.key,
    required this.api,
    required this.mode,
    required this.token,
    required this.product,
    this.offline = false,
  });

  final ApiClient api;
  final Mode mode;
  final String token;
  final Product product;
  /// Barang dikenali dari data di HP karena server tidak terjangkau.
  final bool offline;

  @override
  State<QuantityScreen> createState() => _QuantityScreenState();
}

class _QuantityScreenState extends State<QuantityScreen> {
  final _form = GlobalKey<FormState>();
  final _quantity = TextEditingController();
  // Satu kunci per transaksi: kirim ulang dari layar ini tidak tercatat dua kali.
  final _clientRef = newClientRef();
  bool _busy = false;

  /// Offline: stok terakhir di HP dikurangi/ditambah antrean yang belum terkirim.
  Product get _product => widget.offline
      ? Product(
          id: widget.product.id,
          sku: widget.product.sku,
          name: widget.product.name,
          unit: widget.product.unit,
          stock: widget.api.store.offline.estimatedStock(widget.token, widget.product),
          locationCode: widget.product.locationCode,
          roomName: widget.product.roomName,
        )
      : widget.product;

  @override
  void dispose() {
    _quantity.dispose();
    super.dispose();
  }

  Future<void> _next() async {
    if (_busy || !_form.currentState!.validate()) return;
    final quantity = parseQuantity(
      _quantity.text,
      decimal: allowsDecimal(widget.product.unit),
    )!;
    if (widget.mode.needsReservation) {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => ReservationScreen(
            api: widget.api,
            mode: widget.mode,
            token: widget.token,
            product: widget.product,
            quantity: quantity,
            offline: widget.offline,
          ),
        ),
      );
      return;
    }
    setState(() => _busy = true);
    await submitTransaction(
      context,
      api: widget.api,
      mode: widget.mode,
      token: widget.token,
      product: widget.product,
      quantity: quantity,
      clientRef: _clientRef,
      offline: widget.offline,
    );
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final product = _product;
    final inbound = widget.mode == Mode.inbound;
    final decimal = allowsDecimal(product.unit);
    final quantity = parseQuantity(_quantity.text, decimal: decimal);
    final after = quantity == null
        ? null
        : roundStock(product.stock + (inbound ? quantity : -quantity));
    final offline = widget.offline;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: modeColor(widget.mode),
        foregroundColor: Colors.white,
        title: Text('Jumlah · ${widget.mode.label}'),
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
                    if (offline) ...[const OfflineNotice(), const SizedBox(height: 16)],
                    ProductCard(
                      product: product,
                      stockLabel: offline ? 'Perkiraan stok' : 'Stok saat ini',
                    ),
                    const SizedBox(height: 24),
                    Text(
                      'Jumlah barang ${inbound ? 'masuk' : 'keluar'}',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    TextFormField(
                      key: const Key('quantity'),
                      controller: _quantity,
                      autofocus: true,
                      keyboardType: decimal
                          ? const TextInputType.numberWithOptions(decimal: true)
                          : TextInputType.number,
                      inputFormatters: decimal
                          ? [DecimalInputFormatter()]
                          : [...digitsOnly, LengthLimitingTextInputFormatter(10)],
                      textAlign: TextAlign.center,
                      textInputAction: TextInputAction.done,
                      style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
                      decoration: InputDecoration(
                        hintText: '0',
                        helperText: decimal
                            ? 'Boleh berkoma, mis. 2,5 (maks. 3 angka di belakang koma)'
                            : null,
                        suffixText: product.unit,
                        suffixStyle: const TextStyle(fontSize: 18),
                      ),
                      // Offline: stok di HP bisa sudah berbeda, jadi tidak memblokir;
                      // server memeriksa stok saat antrean terkirim.
                      validator: (value) => validateQuantity(
                        value,
                        stock: inbound || offline ? null : product.stock,
                        decimal: decimal,
                      ),
                      onChanged: (_) => setState(() {}),
                      onFieldSubmitted: (_) => _next(),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      after == null || quantity == 0
                          ? 'Stok: ${formatQty(product.stock)} ${product.unit}'
                          : 'Stok: ${formatQty(product.stock)} → ${formatQty(after)} ${product.unit}',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 16,
                        color: after != null && after < 0 ? Colors.red : null,
                      ),
                    ),
                    if (offline && after != null && after < 0)
                      const Padding(
                        padding: EdgeInsets.only(top: 6),
                        child: Text(
                          'Melebihi perkiraan stok di HP. Tetap bisa disimpan; '
                          'server memeriksa stok saat terkirim.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.red),
                        ),
                      ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                child: FilledButton(
                  onPressed: _busy ? null : _next,
                  style: FilledButton.styleFrom(
                    backgroundColor: modeColor(widget.mode),
                    minimumSize: const Size.fromHeight(54),
                  ),
                  child: _busy
                      ? const SizedBox.square(
                          dimension: 22,
                          child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                        )
                      : Text(widget.mode.needsReservation ? 'LANJUT' : 'SELESAI'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
