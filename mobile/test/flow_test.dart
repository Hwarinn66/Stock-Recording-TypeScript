import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:warehouse_scanner/api.dart';
import 'package:warehouse_scanner/screens/quantity_screen.dart';
import 'package:warehouse_scanner/screens/scan_screen.dart';
import 'package:warehouse_scanner/session_store.dart';

const token = '550e8400-e29b-41d4-a716-446655440001';
final product = Product(
  id: 3,
  sku: 'PB1A00003',
  name: 'U-RING SEAL',
  unit: 'PCS',
  stock: 99,
  locationCode: 'A.01.03',
  roomName: 'Ruangan 1',
);

final kgProduct = Product(
  id: 9,
  sku: 'CB4A60001',
  name: 'WELDING;ELECTRODE',
  unit: 'Kg',
  stock: 548.8,
  locationCode: 'B.05.05.008',
  roomName: 'Ruangan 1',
);

Map<String, Object?> productJson(Product p) => {
  'id': p.id,
  'sku': p.sku,
  'name': p.name,
  'unit': p.unit,
  'stock': p.stock,
  'location_code': p.locationCode,
  'room_name': p.roomName,
};

/// Server palsu: mencatat body transaksi dan menjawab seperti API asli.
Future<(ApiClient, List<Map<String, dynamic>>)> fakeApi({
  Product? item,
  http.Response Function(Map<String, dynamic> body)? respond,
}) async {
  final subject = item ?? product;
  SharedPreferences.setMockInitialValues({'server_url': 'https://srv:3000'});
  final store = await SessionStore.load();
  final sent = <Map<String, dynamic>>[];
  final api = ApiClient(
    store,
    MockClient((request) async {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      sent.add(body);
      if (respond != null) return respond(body);
      final quantity = body['quantity'] as num;
      final before = subject.stock;
      final after = body['mode'] == 'IN' ? before + quantity : before - quantity;
      return http.Response(
        jsonEncode({
          'success': true,
          'data': {
            'transaction_number': '${body['mode']}-20261023-0001',
            'quantity': quantity,
            'stock_before': before,
            'stock_after': (after * 1000).round() / 1000,
            'reservation_number': body['reservation_number'],
            'product': productJson(subject),
          },
        }),
        200,
      );
    }),
  );
  return (api, sent);
}

/// Tumpukan seperti di aplikasi: menu → scan → layar jumlah.
Future<void> openQuantity(
  WidgetTester tester,
  ApiClient api,
  Mode mode, {
  Product? item,
}) async {
  final navigator = GlobalKey<NavigatorState>();
  await tester.pumpWidget(
    MaterialApp(
      navigatorKey: navigator,
      initialRoute: ScanScreen.routeName,
      routes: {
        '/': (_) => const Scaffold(body: Text('menu')),
        ScanScreen.routeName: (_) => const Scaffold(body: Text('kamera scan')),
      },
    ),
  );
  navigator.currentState!.push(
    MaterialPageRoute<void>(
      builder: (_) => QuantityScreen(
        api: api,
        mode: mode,
        token: token,
        product: item ?? product,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Finder field(String key) => find.descendant(
  of: find.byKey(Key(key)),
  matching: find.byType(EditableText),
);

String text(WidgetTester tester, String key) =>
    tester.widget<EditableText>(field(key)).controller.text;

void main() {
  testWidgets('OUT: angka saja, batas stok, no reservasi 7 angka, lalu selesai', (tester) async {
    final (api, sent) = await fakeApi();
    await openQuantity(tester, api, Mode.outbound);

    final quantityInput = tester.widget<EditableText>(field('quantity'));
    expect(quantityInput.keyboardType, TextInputType.number);
    await tester.enterText(find.byKey(const Key('quantity')), '1a2-b');
    expect(text(tester, 'quantity'), '12', reason: 'huruf & simbol ditolak');

    await tester.enterText(find.byKey(const Key('quantity')), '150');
    await tester.tap(find.text('LANJUT'));
    await tester.pumpAndSettle();
    expect(find.text('Stok tidak mencukupi. Stok tersedia: 99.'), findsOneWidget);
    expect(sent, isEmpty);

    await tester.enterText(find.byKey(const Key('quantity')), '5');
    await tester.pump();
    expect(find.text('Stok: 99 → 94 PCS'), findsOneWidget);
    await tester.tap(find.text('LANJUT'));
    await tester.pumpAndSettle();
    expect(find.text('No Reservasi'), findsOneWidget);

    expect(tester.widget<EditableText>(field('reservation')).keyboardType, TextInputType.number);
    await tester.enterText(find.byKey(const Key('reservation')), '12345678x');
    expect(text(tester, 'reservation'), '1234567', reason: 'maksimal 7 angka');

    await tester.enterText(find.byKey(const Key('reservation')), '123');
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(find.text('No reservasi harus tepat 7 angka.'), findsOneWidget);
    expect(sent, isEmpty);

    await tester.enterText(find.byKey(const Key('reservation')), '0012345');
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(sent.single, {
      'qr_token': token,
      'mode': 'OUT',
      'quantity': 5,
      'reservation_number': '0012345',
      // Kunci pengiriman unik: kirim ulang tidak tercatat dua kali.
      'client_ref': matches(RegExp(r'^[0-9a-f-]{36}$')),
    });
    expect(find.text('Transaksi berhasil'), findsOneWidget);
    expect(find.text('0012345'), findsOneWidget);
    expect(find.text('99 → 94 PCS'), findsOneWidget);

    // Kembali ke kamera; layar jumlah/reservasi sudah tidak ada di tumpukan.
    await tester.tap(find.text('SCAN BERIKUTNYA'));
    await tester.pumpAndSettle();
    expect(find.text('kamera scan'), findsOneWidget);
  });

  testWidgets('IN: tanpa no reservasi, langsung selesai', (tester) async {
    final (api, sent) = await fakeApi();
    await openQuantity(tester, api, Mode.inbound);
    expect(find.text('LANJUT'), findsNothing);
    await tester.enterText(find.byKey(const Key('quantity')), '0');
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(find.text('Isi jumlah lebih dari 0.'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('quantity')), '3');
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(sent.single.containsKey('reservation_number'), isFalse);
    expect(find.text('+3 PCS'), findsOneWidget);
    expect(find.text('99 → 102 PCS'), findsOneWidget);
    expect(find.text('No reservasi'), findsNothing);
  });

  testWidgets('Kg: keyboard desimal, koma diterima tanpa pembulatan', (tester) async {
    final (api, sent) = await fakeApi(item: kgProduct);
    await openQuantity(tester, api, Mode.outbound, item: kgProduct);

    final input = tester.widget<EditableText>(field('quantity'));
    expect(input.keyboardType, const TextInputType.numberWithOptions(decimal: true));
    expect(find.text('Stok saat ini: 548.8 Kg'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('quantity')), '0,3x');
    expect(text(tester, 'quantity'), '', reason: 'huruf membuat input ditolak');
    await tester.enterText(find.byKey(const Key('quantity')), '0,3');
    await tester.pump();
    expect(find.text('Stok: 548.8 → 548.5 Kg'), findsOneWidget);
    // Angka desimal ke-4 ditolak formatter, nilai tetap 0,3.
    tester.testTextInput.updateEditingValue(const TextEditingValue(text: '0,3456'));
    await tester.pump();
    expect(text(tester, 'quantity'), '0,3');

    await tester.tap(find.text('LANJUT'));
    await tester.pumpAndSettle();
    expect(find.text('Jumlah keluar: 0.3 Kg'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('reservation')), '0012345');
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(sent.single['quantity'], 0.3);
    expect(find.text('−0.3 Kg'), findsOneWidget);
    expect(find.text('548.8 → 548.5 Kg'), findsOneWidget);
  });

  testWidgets('PCS tetap bulat: koma ditolak', (tester) async {
    final (api, _) = await fakeApi();
    await openQuantity(tester, api, Mode.inbound);
    await tester.enterText(find.byKey(const Key('quantity')), '2,5');
    expect(text(tester, 'quantity'), '25', reason: 'koma dibuang untuk satuan bukan Kg');
  });

  testWidgets('penolakan server tampil dan user tetap di layar jumlah', (tester) async {
    final (api, sent) = await fakeApi(
      respond: (_) => http.Response(
        jsonEncode({
          'success': false,
          'code': 'STOCK_NOT_ENOUGH',
          'message': 'Stok tidak mencukupi. Stok tersedia: 2. Quantity keluar: 3.',
        }),
        409,
      ),
    );
    await openQuantity(tester, api, Mode.inbound);
    await tester.enterText(find.byKey(const Key('quantity')), '3');
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(sent, hasLength(1));
    expect(find.text('Stok tidak mencukupi. Stok tersedia: 2. Quantity keluar: 3.'), findsOneWidget);
    expect(find.byKey(const Key('quantity')), findsOneWidget);
  });

  test('formatter angka juga menolak paste dari keyboard fisik', () {
    final formatted = FilteringTextInputFormatter.digitsOnly.formatEditUpdate(
      TextEditingValue.empty,
      const TextEditingValue(text: '12-34 ab'),
    );
    expect(formatted.text, '1234');
  });
}
