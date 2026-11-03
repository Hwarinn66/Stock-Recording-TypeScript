import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:warehouse_scanner/api.dart';
import 'package:warehouse_scanner/offline.dart';
import 'package:warehouse_scanner/scan_session.dart';
import 'package:warehouse_scanner/screens/session_screen.dart';
import 'package:warehouse_scanner/session_store.dart';

const number = '0012345';

http.Response ok(Object data) => http.Response(jsonEncode({'success': true, 'data': data}), 200);

http.Response fail(String code, String message, int status) =>
    http.Response(jsonEncode({'success': false, 'code': code, 'message': message}), status);

Map<String, Object?> itemJson(int productId, String sku, num quantity) => {
  'product_id': productId,
  'sku': sku,
  'name': 'Barang $sku',
  'unit': 'PCS',
  'quantity': quantity,
  'scanned_at': '2026-11-03 02:15:00',
  'transaction_number': 'OUT-20261103-000$productId',
};

Map<String, Object?> reservationJson({int total = 5, List<Map<String, Object?>> items = const []}) => {
  'reservation_number': number,
  'total_items': total,
  'taken': items.length,
  'status': items.length >= total ? 'DONE' : 'OPEN',
  'items': items,
};

/// Server palsu: [handler] menjawab tiap request; semua request dicatat.
Future<(ApiClient, List<http.Request>)> fakeServer(http.Response Function(http.Request request) handler) async {
  SharedPreferences.setMockInitialValues({'server_url': 'https://srv:3000'});
  final store = await SessionStore.load();
  final requests = <http.Request>[];
  final api = ApiClient(
    store,
    MockClient((request) async {
      requests.add(request);
      return handler(request);
    }),
  );
  return (api, requests);
}

/// Server tidak terjangkau.
Future<ApiClient> offlineServer() async {
  SharedPreferences.setMockInitialValues({'server_url': 'https://srv:3000'});
  final store = await SessionStore.load();
  return ApiClient(store, MockClient((_) async => throw http.ClientException('offline')));
}

/// Menu → OUT (layar no reservasi) / IN (layar kode masuk).
Future<void> openOut(WidgetTester tester, ApiClient api, {Mode mode = Mode.outbound}) async {
  final navigator = GlobalKey<NavigatorState>();
  await tester.pumpWidget(
    MaterialApp(
      navigatorKey: navigator,
      home: const Scaffold(body: Text('menu')),
    ),
  );
  navigator.currentState!.push(
    MaterialPageRoute<void>(
      builder: (_) => SessionStartScreen(api: api, mode: mode),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> openIn(WidgetTester tester, ApiClient api) => openOut(tester, api, mode: Mode.inbound);

/// Kode masuk: 7 angka, titik terisi otomatis.
Future<void> enterInCode(WidgetTester tester, String digits) async {
  await tester.enterText(find.byKey(const Key('in-code')), digits);
  await tester.tap(find.text('LANJUT'));
  await tester.pumpAndSettle();
}

Map<String, Object?> receiptJson(String code, {int total = 5, List<Map<String, Object?>> items = const []}) => {
  'in_code': code,
  'total_items': total,
  'taken': items.length,
  'status': items.length >= total ? 'DONE' : 'OPEN',
  'items': items,
};

Product product(int id, String sku, {String? category}) => Product(
  id: id,
  sku: sku,
  name: 'Barang $sku',
  unit: 'PCS',
  stock: 10,
  locationCode: 'A.01',
  categoryName: category,
);

Future<void> enterNumber(WidgetTester tester, [String value = number]) async {
  await tester.enterText(find.byKey(const Key('reservation')), value);
  await tester.tap(find.text('LANJUT'));
  await tester.pumpAndSettle();
}

/// Gulir layar sesi sampai [finder] terlihat penuh (layar uji hanya 800×600).
Future<void> reveal(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(finder, 150, scrollable: find.byType(Scrollable).first);
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
}

String progress(WidgetTester tester) => tester.widget<Text>(find.byKey(const Key('progress'))).data!;

QueuedTransaction queuedOut(int productId, String sku) => QueuedTransaction(
  clientRef: 'ref-$productId',
  token: 'token-$productId',
  mode: Mode.outbound,
  quantity: 2,
  reservationNumber: number,
  reservationTotal: 2,
  product: Product(id: productId, sku: sku, name: 'Barang $sku', unit: 'PCS', stock: 10, locationCode: 'A.01'),
  recordedAt: DateTime.utc(2026, 11, 3, 2, 15),
);

void main() {
  testWidgets('reservasi baru: no reservasi 7 angka, lalu total item, lalu layar sesi', (tester) async {
    final (api, requests) = await fakeServer(
      (r) => r.method == 'GET'
          ? fail('RESERVATION_NOT_FOUND', 'Reservasi belum ada.', 404)
          : ok(reservationJson(total: 5)),
    );
    await openOut(tester, api);

    await enterNumber(tester, '123');
    expect(find.text('No reservasi harus tepat 7 angka.'), findsOneWidget);
    expect(requests, isEmpty);

    await enterNumber(tester);
    expect(requests.single.url.path, '/api/reservations/$number');
    expect(find.text('Reservasi baru. Total item yang akan diambil'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('total')), '0');
    await tester.tap(find.text('MULAI SCAN'));
    await tester.pumpAndSettle();
    expect(find.text('Total item minimal 1.'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('total')), '5');
    await tester.tap(find.text('MULAI SCAN'));
    await tester.pumpAndSettle();
    expect(requests.last.method, 'POST');
    expect(jsonDecode(requests.last.body), {'reservation_number': number, 'total_items': 5});
    expect(find.text('OUT · $number'), findsOneWidget);
    expect(progress(tester), '0 dari 5 barang');
    expect(find.text('BELUM SELESAI · kurang 5 barang'), findsOneWidget);
    expect(find.text('SCAN BARANG (1/5)'), findsOneWidget);
    expect(find.text('Belum ada barang yang di-scan.'), findsOneWidget);
  });

  testWidgets('lanjutkan reservasi yang belum selesai tanpa isi total lagi, lalu keluar', (tester) async {
    final (api, requests) = await fakeServer(
      (_) => ok(reservationJson(items: [itemJson(1, 'SKU-A', 3), itemJson(2, 'SKU-B', 1)])),
    );
    await openOut(tester, api);
    await enterNumber(tester);
    expect(requests, hasLength(1), reason: 'tidak membuat reservasi baru');
    expect(find.byKey(const Key('total')), findsNothing);
    expect(progress(tester), '2 dari 5 barang');
    expect(find.text('SCAN BARANG (3/5)'), findsOneWidget);
    await reveal(tester, find.text('SKU-B · Barang SKU-B'));
    expect(find.text('SKU-A · Barang SKU-A'), findsOneWidget);

    // Boleh keluar walau belum selesai; status tetap belum selesai.
    await reveal(tester, find.byKey(const Key('exit')));
    expect(find.text('Status tetap belum selesai. Lanjutkan dengan no reservasi $number.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('exit')));
    await tester.pumpAndSettle();
    expect(find.text('menu'), findsOneWidget);
  });

  testWidgets('reservasi yang sudah selesai: tidak bisa scan lagi', (tester) async {
    final (api, _) = await fakeServer(
      (_) => ok(reservationJson(total: 2, items: [itemJson(1, 'SKU-A', 3), itemJson(2, 'SKU-B', 1)])),
    );
    await openOut(tester, api);
    await enterNumber(tester);
    expect(progress(tester), '2 dari 2 barang');
    expect(find.text('SELESAI · semua barang sudah diambil'), findsOneWidget);
    expect(find.byKey(const Key('scan')), findsNothing);
    expect(find.text('SELESAI · kembali ke menu'), findsOneWidget);
  });

  testWidgets('ubah total item: tidak boleh kurang dari barang yang sudah diambil', (tester) async {
    final (api, requests) = await fakeServer(
      (r) => r.method == 'PATCH'
          ? ok(reservationJson(total: 3, items: [itemJson(1, 'SKU-A', 3), itemJson(2, 'SKU-B', 1)]))
          : ok(reservationJson(items: [itemJson(1, 'SKU-A', 3), itemJson(2, 'SKU-B', 1)])),
    );
    await openOut(tester, api);
    await enterNumber(tester);
    await tester.tap(find.byKey(const Key('change-total')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('new-total')), '1');
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();
    expect(find.text('Total item tidak boleh kurang dari barang yang sudah diambil (2).'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('new-total')), '3');
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();
    expect(requests.last.method, 'PATCH');
    expect(requests.last.url.path, '/api/reservations/$number');
    expect(jsonDecode(requests.last.body), {'total_items': 3});
    expect(progress(tester), '2 dari 3 barang');
  });

  testWidgets('reservasi baru saja dimulai di HP lain: dilanjutkan', (tester) async {
    // Cek pertama: belum ada. Saat dibuat: HP lain sudah lebih dulu memulainya.
    var gets = 0;
    final (api, _) = await fakeServer((r) {
      if (r.method == 'POST') return fail('RESERVATION_EXISTS', 'Reservasi sudah dimulai.', 409);
      return gets++ == 0
          ? fail('RESERVATION_NOT_FOUND', 'Reservasi belum ada.', 404)
          : ok(reservationJson(total: 4, items: [itemJson(1, 'SKU-A', 3)]));
    });
    await openOut(tester, api);
    await enterNumber(tester);
    await tester.enterText(find.byKey(const Key('total')), '9');
    await tester.tap(find.text('MULAI SCAN'));
    await tester.pumpAndSettle();
    expect(find.text('Reservasi $number sudah dimulai (total 4 item). Dilanjutkan.'), findsOneWidget);
    expect(progress(tester), '1 dari 4 barang');
  });

  testWidgets('offline: reservasi dimulai di HP, barang di antrean ikut terhitung', (tester) async {
    final api = await offlineServer();
    await openOut(tester, api);
    await enterNumber(tester);
    expect(find.textContaining('Server tidak terjangkau'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('total')), '2');
    await tester.tap(find.text('MULAI SCAN'));
    await tester.pumpAndSettle();
    expect(progress(tester), '0 dari 2 barang');
    expect(find.text('Server tidak terjangkau. Progres dari data terakhir di HP.'), findsOneWidget);

    await api.store.offline.enqueue(queuedOut(7, 'SKU-G'));
    await tester.pumpAndSettle();
    expect(progress(tester), '1 dari 2 barang');
    expect(find.text('1 barang tersimpan di HP, dikirim otomatis saat server bisa dihubungi.'), findsOneWidget);
    await reveal(tester, find.textContaining('tersimpan di HP', findRichText: true).last);
    expect(find.text('SKU-G · Barang SKU-G'), findsOneWidget);
  });

  testWidgets('offline: lanjutkan dari data terakhir di HP', (tester) async {
    final api = await offlineServer();
    await api.store.offline.rememberSession(
      Mode.outbound,
      SessionInfo.fromJson(reservationJson(total: 3, items: [itemJson(1, 'SKU-A', 3)])),
    );
    await openOut(tester, api);
    await enterNumber(tester);
    expect(find.byKey(const Key('total')), findsNothing);
    expect(progress(tester), '1 dari 3 barang');
  });

  testWidgets('IN kode masuk baru (bukan ATK): 7 angka, total item, lalu layar sesi', (tester) async {
    final (api, requests) = await fakeServer(
      (r) => r.method == 'GET'
          ? fail('RECEIPT_NOT_FOUND', 'Kode masuk belum ada.', 404)
          : ok(receiptJson('216.09.26', total: 3)),
    );
    await openIn(tester, api);
    expect(find.text('IN · Kode Masuk'), findsOneWidget);
    expect(find.byKey(const Key('reservation')), findsNothing);

    await enterInCode(tester, '21609');
    expect(find.text('Kode masuk harus 7 angka, mis. 111.22.33.'), findsOneWidget);
    expect(requests, isEmpty);

    await enterInCode(tester, '2160926');
    expect(requests.single.url.path, '/api/receipts/216.09.26');
    expect(find.text('Kode masuk baru. Total item yang masuk'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('total')), '3');
    await tester.tap(find.text('MULAI SCAN'));
    await tester.pumpAndSettle();
    expect(requests.last.method, 'POST');
    expect(requests.last.url.path, '/api/receipts');
    expect(jsonDecode(requests.last.body), {'in_code': '216.09.26', 'total_items': 3});
    expect(find.text('IN · 216.09.26'), findsOneWidget);
    expect(find.text('Kode masuk 216.09.26 · barang bukan ATK'), findsOneWidget);
    expect(progress(tester), '0 dari 3 barang');
    expect(find.text('SCAN BARANG (1/3)'), findsOneWidget);
  });

  testWidgets('IN kode masuk ATK: ATK. ditambahkan, dilanjutkan, ubah total', (tester) async {
    const code = 'ATK.216.09.26';
    final items = [itemJson(1, 'SKU-A', 3), itemJson(2, 'SKU-B', 1)];
    final (api, requests) = await fakeServer(
      (r) => r.method == 'PATCH' ? ok(receiptJson(code, total: 3, items: items)) : ok(receiptJson(code, items: items)),
    );
    await openIn(tester, api);
    await tester.tap(find.text('ATK'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Format: ATK.111.22.33, hanya barang ATK.'), findsOneWidget);
    await enterInCode(tester, '2160926');
    expect(requests.single.url.path, '/api/receipts/$code');
    expect(find.byKey(const Key('total')), findsNothing, reason: 'kode masuk sudah dimulai');
    expect(find.text('Kode masuk $code · barang ATK'), findsOneWidget);
    expect(progress(tester), '2 dari 5 barang');
    expect(find.text('Barang yang sudah masuk'), findsOneWidget);

    await tester.tap(find.byKey(const Key('change-total')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('new-total')), '1');
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();
    expect(find.text('Total item tidak boleh kurang dari barang yang sudah masuk (2).'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('new-total')), '3');
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();
    expect(requests.last.method, 'PATCH');
    expect(requests.last.url.path, '/api/receipts/$code');
    expect(progress(tester), '2 dari 3 barang');

    await reveal(tester, find.byKey(const Key('exit')));
    expect(find.text('Status tetap belum selesai. Lanjutkan dengan kode masuk $code.'), findsOneWidget);
  });

  testWidgets('IN: ganti ATK / bukan ATK setelah kode diperiksa → periksa lagi', (tester) async {
    final (api, requests) = await fakeServer((_) => fail('RECEIPT_NOT_FOUND', 'Kode masuk belum ada.', 404));
    await openIn(tester, api);
    await enterInCode(tester, '2160926');
    expect(find.byKey(const Key('total')), findsOneWidget);
    await tester.tap(find.text('ATK'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('total')), findsNothing);
    await tester.tap(find.text('LANJUT'));
    await tester.pumpAndSettle();
    expect(requests.map((r) => r.url.path), ['/api/receipts/216.09.26', '/api/receipts/ATK.216.09.26']);
  });

  testWidgets('IN offline: kode masuk dimulai di HP, barang di antrean ikut terhitung', (tester) async {
    final api = await offlineServer();
    await openIn(tester, api);
    await enterInCode(tester, '2160926');
    await tester.enterText(find.byKey(const Key('total')), '2');
    await tester.tap(find.text('MULAI SCAN'));
    await tester.pumpAndSettle();
    expect(progress(tester), '0 dari 2 barang');

    await api.store.offline.enqueue(
      QueuedTransaction(
        clientRef: 'ref-7',
        token: 'token-7',
        mode: Mode.inbound,
        quantity: 4,
        inCode: '216.09.26',
        receiptTotal: 2,
        product: product(7, 'SKU-G'),
        recordedAt: DateTime.utc(2026, 11, 3, 2, 15),
      ),
    );
    // Barang keluar dengan no reservasi yang sama tidak ikut terhitung.
    await api.store.offline.enqueue(queuedOut(8, 'SKU-H'));
    await tester.pumpAndSettle();
    expect(progress(tester), '1 dari 2 barang');
    expect(api.store.offline.cachedSession(Mode.inbound, '216.09.26')!.total, 2);
    expect(api.store.offline.cachedSession(Mode.outbound, '216.09.26'), isNull);
  });

  test('sesi IN: barang ATK hanya di kode masuk ATK, satu barang sekali', () async {
    final (api, _) = await fakeServer((_) => ok({}));
    final plain = ScanSession(
      api,
      SessionInfo.fromJson(receiptJson('216.09.26', items: [itemJson(1, 'SKU-A', 3)])),
      mode: Mode.inbound,
    );
    final atk = ScanSession(api, SessionInfo.fromJson(receiptJson('ATK.216.09.26')), mode: Mode.inbound);
    final out = ScanSession(api, SessionInfo.fromJson(reservationJson()), mode: Mode.outbound);

    expect([plain.atk, atk.atk], [false, true]);
    expect(plain.reject(product(2, 'SKU-B')), isNull);
    expect(plain.reject(product(1, 'SKU-A')), 'Barang SKU-A sudah masuk untuk kode masuk 216.09.26. Scan barang lain.');
    expect(plain.reject(product(3, 'PEN', category: 'ATK')), startsWith('Barang PEN adalah barang ATK.'));
    expect(atk.reject(product(3, 'PEN', category: 'atk ')), isNull);
    expect(atk.reject(product(2, 'SKU-B')), startsWith('Barang SKU-B bukan barang ATK.'));
    // Barang keluar: ATK dan bukan ATK boleh dalam satu reservasi.
    expect(out.reject(product(3, 'PEN', category: 'ATK')), isNull);
    for (final s in [plain, atk, out]) {
      s.dispose();
    }
  });

  test('sesi: barang di antrean terhitung, satu barang sekali, tetap terhitung setelah terkirim', () async {
    var served = reservationJson(total: 2);
    final (api, _) = await fakeServer((_) => ok(served));
    final session = ScanSession(api, SessionInfo.fromJson(reservationJson(total: 2)), mode: Mode.outbound);
    expect([session.taken, session.done, session.has(7)], [0, false, false]);

    await api.store.offline.enqueue(queuedOut(7, 'SKU-G'));
    expect([session.taken, session.has(7)], [1, true]);

    // Antrean terkirim: barang keluar dari antrean, progres diambil dari server.
    served = reservationJson(total: 2, items: [itemJson(7, 'SKU-G', 2)]);
    await api.store.offline.removePending('ref-7');
    await pumpEventQueue();
    expect([session.taken, session.pendingItems.length, session.has(7)], [1, 0, true]);

    session.applyResult(
      TransactionResult(
        transactionNumber: 'OUT-20261103-0009',
        quantity: 1,
        stockBefore: 5,
        stockAfter: 4,
        product: Product(id: 8, sku: 'SKU-H', name: 'Barang SKU-H', unit: 'PCS', stock: 4, locationCode: 'A.02'),
        session: SessionProgress(code: number, total: 2, taken: 2, done: true),
      ),
    );
    expect([session.taken, session.done, session.has(8)], [2, true, true]);
    expect(
      api.store.offline.cachedSession(Mode.outbound, number)!.taken,
      2,
      reason: 'disimpan untuk dilanjutkan offline',
    );
    session.dispose();
  });
}
