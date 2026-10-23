import 'package:flutter/material.dart';

import 'api.dart';
import 'screens/login_screen.dart';
import 'validators.dart';

const brandGreen = Color(0xFF047857);
const outBlue = Color(0xFF1D4ED8);

Color modeColor(Mode mode) => mode == Mode.inbound ? brandGreen : outBlue;

ThemeData buildTheme() => ThemeData(
  colorSchemeSeed: brandGreen,
  useMaterial3: true,
  inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
);

/// Memberi tahu layar scan kapan tertutup/terlihat lagi agar kamera ikut mati/nyala.
final routeObserver = RouteObserver<ModalRoute<void>>();

/// Sesi kedaluwarsa di layar mana pun: kembali ke login.
void goToLogin(BuildContext context, ApiClient api, String message) {
  Navigator.of(context).pushAndRemoveUntil(
    MaterialPageRoute<void>(
      builder: (_) => LoginScreen(api: api, notice: message),
    ),
    (_) => false,
  );
}

void showError(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Theme.of(context).colorScheme.error,
        behavior: SnackBarBehavior.floating,
      ),
    );
}

/// Ringkasan barang hasil scan: kode barang dicetak besar agar mudah dicocokkan.
class ProductCard extends StatelessWidget {
  const ProductCard({super.key, required this.product, this.footer});

  final Product product;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(product.name, style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text('KODE BARANG', style: theme.textTheme.labelSmall),
            Text(
              product.sku,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 26,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.place_outlined, size: 18),
                const SizedBox(width: 4),
                Expanded(child: Text(product.place)),
              ],
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                const Icon(Icons.inventory_2_outlined, size: 18),
                const SizedBox(width: 4),
                Text(
                  'Stok saat ini: ${formatQty(product.stock)} ${product.unit}',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ],
            ),
            if (footer != null) ...[const SizedBox(height: 12), footer!],
          ],
        ),
      ),
    );
  }
}
