import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:warehouse_scanner/api.dart';
import 'package:warehouse_scanner/scan_session.dart';
import 'package:warehouse_scanner/screens/quantity_screen.dart';
import 'package:warehouse_scanner/screens/session_screen.dart';
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
            'in_code': body['in_code'],
            'product': productJson(subject),
            // Sesi scan: progres setelah barang ini (server palsu: barang ke-1).
            if (body['reservation_total'] != null)
              'reservation': {
                'reservation_number': body['reservation_number'],
                'total_items': body['reservation_total'],
                'taken': 1,
                'status': body['reservation_total'] == 1 ? 'DONE' : 'OPEN',
              },
            if (body['receipt_total'] != null)
              'receipt': {
                'in_code': body['in_code'],
                'total_items': body['receipt_total'],
                'taken': 1,
                'status': body['receipt_total'] == 1 ? 'DONE' : 'OPEN',
              },
          },
        }),
        200,
      );
    }),
  );
  return (api, sent);
}

/// Sesi reservasi baru 0012345 dengan [total] item.
ScanSession newSession(ApiClient api, {int total = 3}) => ScanSession(
  api,
  SessionInfo(code: '0012345', total: total, taken: 0, items: []),
  mode: Mode.outbound,
);

/// Tumpukan seperti di aplikasi: menu → (sesi reservasi) → scan → layar jumlah.
Future<void> openQuantity(WidgetTester tester, ApiClient api, Mode mode, {Product? item, ScanSession? session}) async {
  final navigator = GlobalKey<NavigatorState>();
  await tester.pumpWidget(
    MaterialApp(
      navigatorKey: navigator,
      routes: {
        '/': (_) => const Scaffold(body: Text('menu')),
        SessionScreen.routeName: (_) => const Scaffold(body: Text('ringkasan reservasi')),
        ScanScreen.routeName: (_) => const Scaffold(body: Text('kamera scan')),
      },
    ),
  );
  if (session != null) navigator.currentState!.pushNamed(SessionScreen.routeName);
  navigator.currentState!.pushNamed(ScanScreen.routeName);
  navigator.currentState!.push(
    MaterialPageRoute<void>(
      builder: (_) => QuantityScreen(api: api, mode: mode, token: token, product: item ?? product, session: session),
    ),
  );
  await tester.pumpAndSettle();
}

Finder field(String key) => find.descendant(of: find.byKey(Key(key)), matching: find.byType(EditableText));

String text(WidgetTester tester, String key) => tester.widget<EditableText>(field(key)).controller.text;

/// Gulir daftar utama layar sampai [finder] terlihat penuh (layar uji hanya 800×600).
Future<void> reveal(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(finder, 150, scrollable: find.byType(Scrollable).first);
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('OUT dalam sesi reservasi: angka saja, batas stok, tanpa ketik no reservasi lagi', (tester) async {
    final (api, sent) = await fakeApi();
    final session = newSession(api);
    await openQuantity(tester, api, Mode.outbound, session: session);
    expect(find.text('Reservasi 0012345 · barang ke-1 dari 3'), findsOneWidget);

    final quantityInput = tester.widget<EditableText>(field('quantity'));
    expect(quantityInput.keyboardType, TextInputType.number);
    await tester.enterText(find.byKey(const Key('quantity')), '1a2-b');
    expect(text(tester, 'quantity'), '12', reason: 'huruf & simbol ditolak');

    await tester.enterText(find.byKey(const Key('quantity')), '150');
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(find.text('Stok tidak mencukupi. Stok tersedia: 99.'), findsOneWidget);
    expect(sent, isEmpty);

    await tester.enterText(find.byKey(const Key('quantity')), '5');
    await tester.pump();
    expect(find.text('Stok: 99 → 94 PCS'), findsOneWidget);
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(sent.single, {
      'qr_token': token,
      'mode': 'OUT',
      'quantity': 5,
      'reservation_number': '0012345',
      'reservation_total': 3,
      // Kunci pengiriman unik: kirim ulang tidak tercatat dua kali.
      'client_ref': matches(RegExp(r'^[0-9a-f-]{36}$')),
    });
    expect(find.text('Transaksi berhasil'), findsOneWidget);
    expect(find.text('0012345'), findsOneWidget);
    expect(find.text('99 → 94 PCS'), findsOneWidget);
    expect(find.text('Reservasi 0012345: 1 dari 3 barang. Belum selesai, kurang 2 barang.'), findsOneWidget);
    expect(session.has(product.id), isTrue);

    // Belum selesai: kembali ke kamera untuk barang berikutnya.
    await reveal(tester, find.text('SCAN BERIKUTNYA (2/3)'));
    await tester.tap(find.text('SCAN BERIKUTNYA (2/3)'));
    await tester.pumpAndSettle();
    expect(find.text('kamera scan'), findsOneWidget);
    session.dispose();
  });

  testWidgets('OUT barang terakhir reservasi: SELESAI lalu ke ringkasan', (tester) async {
    final (api, _) = await fakeApi();
    final session = newSession(api, total: 1);
    await openQuantity(tester, api, Mode.outbound, session: session);
    await tester.enterText(find.byKey(const Key('quantity')), '2');
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(find.text('Reservasi 0012345 SELESAI: 1 dari 1 barang.'), findsOneWidget);
    expect(session.done, isTrue);
    await reveal(tester, find.text('SELESAI · lihat ringkasan'));
    await tester.tap(find.text('SELESAI · lihat ringkasan'));
    await tester.pumpAndSettle();
    expect(find.text('ringkasan reservasi'), findsOneWidget);
    session.dispose();
  });

  testWidgets('IN dalam sesi kode masuk: jumlah lalu langsung selesai, kode masuk dari sesi', (tester) async {
    final (api, sent) = await fakeApi();
    final session = ScanSession(
      api,
      SessionInfo(code: '216.09.26', total: 2, taken: 0, items: []),
      mode: Mode.inbound,
    );
    await openQuantity(tester, api, Mode.inbound, session: session);
    expect(find.text('Kode masuk 216.09.26 · barang ke-1 dari 2'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('quantity')), '3');
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('in-code')), findsNothing, reason: 'kode masuk tidak diketik lagi');
    expect(sent.single, {
      'qr_token': token,
      'mode': 'IN',
      'quantity': 3,
      'in_code': '216.09.26',
      'receipt_total': 2,
      'client_ref': matches(RegExp(r'^[0-9a-f-]{36}$')),
    });
    expect(find.text('+3 PCS'), findsOneWidget);
    expect(find.text('99 → 102 PCS'), findsOneWidget);
    expect(find.text('Kode masuk 216.09.26: 1 dari 2 barang. Belum selesai, kurang 1 barang.'), findsOneWidget);
    expect(session.has(product.id), isTrue);
    await reveal(tester, find.text('SCAN BERIKUTNYA (2/2)'));
    await tester.tap(find.text('SCAN BERIKUTNYA (2/2)'));
    await tester.pumpAndSettle();
    expect(find.text('kamera scan'), findsOneWidget);
    session.dispose();
  });

  testWidgets('IN tanpa sesi: jumlah lalu kode masuk 111.22.33 (titik otomatis), tanpa no reservasi', (tester) async {
    final (api, sent) = await fakeApi();
    await openQuantity(tester, api, Mode.inbound);
    await tester.enterText(find.byKey(const Key('quantity')), '0');
    await tester.tap(find.text('LANJUT'));
    await tester.pumpAndSettle();
    expect(find.text('Isi jumlah lebih dari 0.'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('quantity')), '3');
    await tester.tap(find.text('LANJUT'));
    await tester.pumpAndSettle();
    expect(find.text('Kode Masuk'), findsOneWidget);
    expect(find.text('Jumlah masuk: 3 PCS'), findsOneWidget);
    expect(find.text('ATK.'), findsNothing, reason: 'bukan barang ATK');

    // Angka saja, titik terisi otomatis, maksimal 7 angka.
    await tester.enterText(find.byKey(const Key('in-code')), '1112233');
    expect(text(tester, 'in-code'), '111.22.33');
    await tester.enterText(find.byKey(const Key('in-code')), '11a12');
    expect(text(tester, 'in-code'), '111.2');
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(find.text('Kode masuk harus 7 angka, mis. 111.22.33.'), findsOneWidget);
    expect(sent, isEmpty);

    await tester.enterText(find.byKey(const Key('in-code')), '111223399');
    expect(text(tester, 'in-code'), '111.22.33');
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(sent.single['in_code'], '111.22.33');
    expect(sent.single.containsKey('reservation_number'), isFalse);
    expect(find.text('+3 PCS'), findsOneWidget);
    expect(find.text('99 → 102 PCS'), findsOneWidget);
    expect(find.text('Kode masuk'), findsOneWidget);
    expect(find.text('111.22.33'), findsOneWidget);
    expect(find.text('No reservasi'), findsNothing);
  });

  testWidgets('IN barang ATK: ATK. sudah tertulis, terkirim ATK.111.22.33', (tester) async {
    final atk = Product(
      id: 5,
      sku: 'SM0A00002',
      name: 'BALLPOINT;BALLINER;BLUE/BLACK',
      unit: 'Bh',
      stock: 18,
      locationCode: 'B.09.03.032',
      roomName: 'Ruangan 1',
      categoryName: 'ATK',
    );
    final (api, sent) = await fakeApi(item: atk);
    await openQuantity(tester, api, Mode.inbound, item: atk);
    await tester.enterText(find.byKey(const Key('quantity')), '2');
    await tester.tap(find.text('LANJUT'));
    await tester.pumpAndSettle();
    expect(find.text('Masukkan kode masuk (barang ATK)'), findsOneWidget);
    expect(find.text('ATK.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('in-code')), '1234567');
    expect(text(tester, 'in-code'), '123.45.67');
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(sent.single['in_code'], 'ATK.123.45.67');
    expect(find.text('ATK.123.45.67'), findsOneWidget);
  });

  testWidgets('Kg: keyboard desimal, koma diterima tanpa pembulatan', (tester) async {
    final (api, sent) = await fakeApi(item: kgProduct);
    final session = newSession(api);
    await openQuantity(tester, api, Mode.outbound, item: kgProduct, session: session);

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

    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(sent.single['quantity'], 0.3);
    expect(find.text('−0.3 Kg'), findsOneWidget);
    expect(find.text('548.8 → 548.5 Kg'), findsOneWidget);
    session.dispose();
  });

  testWidgets('PCS tetap bulat: koma ditolak', (tester) async {
    final (api, _) = await fakeApi();
    await openQuantity(tester, api, Mode.inbound);
    await tester.enterText(find.byKey(const Key('quantity')), '2,5');
    expect(text(tester, 'quantity'), '25', reason: 'koma dibuang untuk satuan bukan Kg');
  });

  testWidgets('penolakan server tampil dan user tetap di layar terakhir', (tester) async {
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
    await tester.tap(find.text('LANJUT'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('in-code')), '1112233');
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(sent, hasLength(1));
    expect(find.text('Stok tidak mencukupi. Stok tersedia: 2. Quantity keluar: 3.'), findsOneWidget);
    expect(find.byKey(const Key('in-code')), findsOneWidget);
  });

  test('formatter angka juga menolak paste dari keyboard fisik', () {
    final formatted = FilteringTextInputFormatter.digitsOnly.formatEditUpdate(
      TextEditingValue.empty,
      const TextEditingValue(text: '12-34 ab'),
    );
    expect(formatted.text, '1234');
  });
}
