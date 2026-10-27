import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:warehouse_scanner/api.dart';
import 'package:warehouse_scanner/screens/home_screen.dart';
import 'package:warehouse_scanner/screens/product_info_screen.dart';
import 'package:warehouse_scanner/session_store.dart';

const token = '550e8400-e29b-41d4-a716-446655440001';

Map<String, Object?> infoJson({int active = 1, String? pending}) => {
  'product': {
    'id': 3,
    'sku': 'PB1A00003',
    'name': 'U-RING;SEAL;PACKING;Ø1"',
    'unit': 'Pcs',
    'stock': 2,
    'active': active,
    'movement_class': 'FAST',
    'description': 'Untuk hydrotest',
    'category_name': 'Sparepart',
    'location_code': 'A.01.03',
    'room_name': 'Ruangan 1',
    'block_code': 'A',
    'rack_number': 1,
    'position_number': 3,
  },
  'pending': pending,
  'in_30': 10,
  'out_30': 3.5,
  'history': [
    {
      'transaction_number': 'OUT-20261027-0001',
      'transaction_type': 'OUT',
      'status': 'APPROVED',
      'scanned_at': '2026-10-27 01:34:40.000',
      'quantity': 3,
      'stock_after': 2,
      'reservation_number': '0012345',
      'in_code': null,
      'actor_name': 'budi',
    },
    {
      'transaction_number': 'IN-20261026-0004',
      'transaction_type': 'IN',
      'status': 'APPROVED',
      'scanned_at': '2026-10-26 03:00:00.000',
      'quantity': 5,
      'stock_after': 5,
      'reservation_number': null,
      'in_code': '111.22.33',
      'actor_name': 'sari',
    },
  ],
};

Future<SessionStore> freshStore() async {
  SharedPreferences.setMockInitialValues({'server_url': 'https://srv:3000'});
  return SessionStore.load();
}

Future<void> show(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1080, 7200);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(home: screen));
  await tester.pumpAndSettle();
}

void main() {
  test('productInfo memanggil endpoint detail & menyimpan barang untuk offline', () async {
    final store = await freshStore();
    late http.Request seen;
    final api = ApiClient(
      store,
      MockClient((request) async {
        seen = request;
        return http.Response.bytes(utf8.encode(jsonEncode({'success': true, 'data': infoJson()})), 200);
      }),
    );
    final info = await api.productInfo(token);
    expect(seen.method, 'GET');
    expect(seen.url.path, '/api/product-info/$token');
    expect(info.product.categoryName, 'Sparepart');
    expect(info.out30, 3.5);
    expect(info.history.first.reservationNumber, '0012345');
    expect(info.history.last.inCode, '111.22.33');
    expect(info.history.first.scannedAt, DateTime.utc(2026, 10, 27, 1, 34, 40));
    expect(store.offline.product(token)!.sku, 'PB1A00003');
  });

  testWidgets('Cek Barang: detail lengkap, total 30 hari, riwayat', (tester) async {
    await show(tester, ProductInfoScreen(info: ProductInfo.fromJson(infoJson())));
    expect(find.text('Detail Barang'), findsOneWidget);
    expect(find.text('U-RING;SEAL;PACKING;Ø1"'), findsOneWidget);
    expect(find.text('PB1A00003'), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const Key('info-stock'))).data, '2');
    expect(find.text('STOK MENIPIS'), findsOneWidget);
    expect(find.text('Fast moving'), findsOneWidget);
    expect(find.text('Sparepart'), findsOneWidget);
    expect(find.text('Ruangan 1'), findsOneWidget);
    expect(find.text('A.01.03'), findsOneWidget);
    expect(find.text('Blok A · Rak 01 · Posisi 3'), findsOneWidget);
    expect(find.text('Untuk hydrotest'), findsOneWidget);
    expect(find.text('+10 Pcs'), findsOneWidget);
    expect(find.text('−3.5 Pcs'), findsOneWidget);
    expect(find.text('−3 Pcs'), findsOneWidget);
    expect(find.textContaining('Reservasi 0012345'), findsOneWidget);
    expect(find.textContaining('Kode 111.22.33'), findsOneWidget);
    expect(find.text('NONAKTIF'), findsNothing);
    expect(find.textContaining('menunggu proses'), findsNothing);
  });

  testWidgets('Cek Barang: barang nonaktif & transaksi menunggu diberi tanda', (tester) async {
    await show(
      tester,
      ProductInfoScreen(info: ProductInfo.fromJson(infoJson(active: 0, pending: 'IN-20261020-0001'))),
    );
    expect(find.text('NONAKTIF'), findsOneWidget);
    expect(find.textContaining('IN-20261020-0001'), findsOneWidget);
  });

  testWidgets('Cek Barang offline: data terakhir di HP tanpa riwayat', (tester) async {
    await show(
      tester,
      ProductInfoScreen.offline(
        product: Product(
          id: 3,
          sku: 'PB1A00003',
          name: 'U-RING',
          unit: 'Pcs',
          stock: 0,
          locationCode: 'A.01.03',
          roomName: 'Ruangan 1',
          categoryName: 'Sparepart',
        ),
      ),
    );
    expect(find.textContaining('Server tidak terjangkau'), findsOneWidget);
    expect(find.text('STOK TERAKHIR DI HP'), findsOneWidget);
    expect(find.text('STOK HABIS'), findsOneWidget);
    expect(find.text('Riwayat terakhir'), findsNothing);
  });

  testWidgets('menu punya tombol Cek Barang di bawah IN & OUT', (tester) async {
    final store = await freshStore();
    final api = ApiClient(
      store,
      MockClient((_) async => http.Response(jsonEncode({'success': true, 'data': []}), 200)),
    );
    await tester.pumpWidget(MaterialApp(home: HomeScreen(api: api)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('info-button')), findsOneWidget);
    expect(find.text('CEK BARANG · lihat detail barang'), findsOneWidget);
    expect(find.text('IN · Barang Masuk'), findsOneWidget);
    expect(find.text('OUT · Barang Keluar'), findsOneWidget);
    await tester.pumpWidget(const SizedBox()); // hentikan timer menu
  });
}
