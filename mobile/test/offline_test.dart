import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:warehouse_scanner/api.dart';
import 'package:warehouse_scanner/offline.dart';
import 'package:warehouse_scanner/screens/home_screen.dart';
import 'package:warehouse_scanner/screens/quantity_screen.dart';
import 'package:warehouse_scanner/screens/scan_screen.dart';
import 'package:warehouse_scanner/session_store.dart';

const token = '550e8400-e29b-41d4-a716-446655440001';
final uuid = RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
final product = Product(
  id: 3,
  sku: 'PB1A00003',
  name: 'U-RING SEAL',
  unit: 'PCS',
  stock: 10,
  locationCode: 'A.01.03',
  roomName: 'Ruangan 1',
);

Future<SessionStore> freshStore() async {
  SharedPreferences.setMockInitialValues({'server_url': 'https://srv:3000'});
  return SessionStore.load();
}

QueuedTransaction queued(String ref, Mode mode, num quantity, {String? reservation}) => QueuedTransaction(
  clientRef: ref,
  token: token,
  mode: mode,
  quantity: quantity,
  reservationNumber: reservation,
  product: product,
  recordedAt: DateTime.utc(2026, 10, 26, 2, 15),
);

http.Response recorded(Map<String, dynamic> body, {bool replayed = false}) => http.Response(
  jsonEncode({
    'success': true,
    'data': {
      'transaction_number': '${body['mode']}-20261026-0001',
      'quantity': body['quantity'],
      'stock_before': 10,
      'stock_after': 7,
      'reservation_number': body['reservation_number'],
      'replayed': replayed,
      'product': {...product.toJson(), 'stock': 7},
    },
  }),
  200,
);

http.Response failure(String code, String message, int status) =>
    http.Response(jsonEncode({'success': false, 'code': code, 'message': message}), status);

void main() {
  test('client_ref berupa UUID v4 dan selalu berbeda', () {
    final refs = {for (var i = 0; i < 200; i++) newClientRef()};
    expect(refs, hasLength(200));
    expect(refs.every(uuid.hasMatch), isTrue);
    expect(newClientRef(Random(1)), newClientRef(Random(1)));
  });

  test('server mati / error 5xx = simpan di HP; 4xx bukan', () {
    expect(ApiException('x').unavailable, isTrue);
    expect(ApiException('x', status: 503).unavailable, isTrue);
    expect(ApiException('x', status: 409).unavailable, isFalse);
    expect(ApiException('x', status: 401).unavailable, isFalse);
  });

  test('record mengirim client_ref & recorded_at; jawaban ulang dikenali', () async {
    final store = await freshStore();
    final bodies = <Map<String, dynamic>>[];
    final api = ApiClient(
      store,
      MockClient((request) async {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        bodies.add(body);
        return recorded(body, replayed: true);
      }),
    );
    final result = await api.record(
      token: token,
      mode: Mode.outbound,
      quantity: 3,
      reservationNumber: '0012345',
      clientRef: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      recordedAt: DateTime.utc(2026, 10, 26, 2, 15),
    );
    expect(bodies.single['client_ref'], 'f47ac10b-58cc-4372-a567-0e02b2c3d479');
    expect(bodies.single['recorded_at'], '2026-10-26T02:15:00.000Z');
    expect(result.replayed, isTrue);
    // Stok terbaru dari server disimpan untuk scan offline berikutnya.
    expect(store.offline.product(token)!.stock, 7);
  });

  test('antrean tersimpan permanen, perkiraan stok ikut antrean', () async {
    final store = await freshStore();
    await store.offline.saveCatalog({token: product});
    await store.offline.enqueue(queued('a', Mode.outbound, 3, reservation: '0012345'));
    await store.offline.enqueue(queued('a', Mode.outbound, 3)); // kunci sama: tidak dobel
    await store.offline.enqueue(queued('b', Mode.inbound, 1.5));
    // Seperti aplikasi dibuka ulang: dibaca lagi dari penyimpanan.
    final reopened = SessionStore(await SharedPreferences.getInstance()).offline;
    expect(reopened.pending.map((e) => e.clientRef), ['a', 'b']);
    expect(reopened.pending.first.reservationNumber, '0012345');
    expect(reopened.pending.first.recordedAt, DateTime.utc(2026, 10, 26, 2, 15));
    expect(reopened.product(token)!.name, 'U-RING SEAL');
    expect(reopened.estimatedStock(token, product), 8.5);
  });

  test('kirim antrean: urut, yang ditolak dipindah, berhenti saat server mati', () async {
    final store = await freshStore();
    for (final ref in ['ok', 'ditolak', 'putus', 'berikut']) {
      await store.offline.enqueue(queued(ref, Mode.outbound, 1, reservation: '0012345'));
    }
    final sent = <String>[];
    final api = ApiClient(
      store,
      MockClient((request) async {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        sent.add(body['client_ref'] as String);
        expect(body['recorded_at'], '2026-10-26T02:15:00.000Z');
        return switch (body['client_ref']) {
          'ok' => recorded(body),
          'ditolak' => failure('STOCK_NOT_ENOUGH', 'Stok tidak mencukupi.', 409),
          _ => throw http.ClientException('Network is unreachable'),
        };
      }),
    );
    final result = await api.flushQueue();
    expect(sent, ['ok', 'ditolak', 'putus'], reason: 'item sesudah "putus" tidak dikirim mendahului');
    expect(result.sent, 1);
    expect(result.failed, 1);
    expect(result.stopped, 'offline');
    expect(store.offline.pending.map((e) => e.clientRef), ['putus', 'berikut']);
    expect(store.offline.pending.first.attempts, 1);
    expect(store.offline.failed.single.clientRef, 'ditolak');
    expect(store.offline.failed.single.lastError, 'Stok tidak mencukupi.');

    // Kirim ulang yang ditolak: kembali ke antrean (urutan paling akhir).
    await store.offline.retryFailed('ditolak');
    expect(store.offline.pending.map((e) => e.clientRef), ['putus', 'berikut', 'ditolak']);
    expect(store.offline.failed, isEmpty);
  });

  test('sesi berakhir: antrean tetap, berhenti minta login', () async {
    final store = await freshStore();
    await store.offline.enqueue(queued('a', Mode.inbound, 2));
    final api = ApiClient(
      store,
      MockClient((_) async => failure('UNAUTHORIZED', 'Silakan login dahulu.', 401)),
    );
    final result = await api.flushQueue();
    expect(result.stopped, 'login');
    expect(store.offline.pending, hasLength(1));
  });

  test('daftar barang dari server disimpan per token QR', () async {
    final store = await freshStore();
    final api = ApiClient(
      store,
      MockClient((request) async {
        expect(request.url.path, '/api/catalog');
        return http.Response(
          jsonEncode({
            'success': true,
            'data': [
              {...product.toJson(), 'qr_token': token},
            ],
          }),
          200,
        );
      }),
    );
    expect(await api.refreshCatalog(), isTrue);
    expect(store.offline.catalogSize, 1);
    expect(store.offline.product(token)!.sku, 'PB1A00003');
    expect(store.offline.catalogUpdatedAt, isNotNull);
  });

  Future<void> openQuantity(WidgetTester tester, ApiClient api, Mode mode, {bool offline = false}) async {
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
        builder: (_) => QuantityScreen(api: api, mode: mode, token: token, product: product, offline: offline),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('offline: IN disimpan di HP tanpa menghubungi server', (tester) async {
    final store = await freshStore();
    var calls = 0;
    final api = ApiClient(store, MockClient((_) async {
      calls++;
      throw http.ClientException('offline');
    }));
    await openQuantity(tester, api, Mode.inbound, offline: true);
    expect(find.textContaining('Server tidak terjangkau'), findsOneWidget);
    expect(find.text('Perkiraan stok: 10 PCS'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('quantity')), '4');
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(calls, 0);
    expect(find.text('Tersimpan di HP'), findsOneWidget);
    expect(find.text('1 transaksi menunggu dikirim'), findsOneWidget);
    final item = store.offline.pending.single;
    expect(item.mode, Mode.inbound);
    expect(item.quantity, 4);
    expect(uuid.hasMatch(item.clientRef), isTrue);
  });

  testWidgets('offline: OUT melebihi perkiraan stok diberi peringatan, tetap bisa disimpan', (tester) async {
    final store = await freshStore();
    final api = ApiClient(store, MockClient((_) async => throw http.ClientException('offline')));
    await openQuantity(tester, api, Mode.outbound, offline: true);
    await tester.enterText(find.byKey(const Key('quantity')), '12');
    await tester.pump();
    expect(find.textContaining('Melebihi perkiraan stok'), findsOneWidget);
    await tester.tap(find.text('LANJUT'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Server tidak terjangkau'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('reservation')), '0012345');
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(find.text('Tersimpan di HP'), findsOneWidget);
    expect(store.offline.pending.single.reservationNumber, '0012345');
  });

  testWidgets('sinyal putus saat kirim: masuk antrean dengan client_ref yang sama', (tester) async {
    final store = await freshStore();
    final refs = <String>[];
    final api = ApiClient(
      store,
      MockClient((request) async {
        refs.add((jsonDecode(request.body) as Map<String, dynamic>)['client_ref'] as String);
        throw http.ClientException('Connection reset');
      }),
    );
    await openQuantity(tester, api, Mode.inbound);
    await tester.enterText(find.byKey(const Key('quantity')), '2');
    await tester.tap(find.text('SELESAI'));
    await tester.pumpAndSettle();
    expect(find.text('Tersimpan di HP'), findsOneWidget);
    // Bila kiriman pertama ternyata sudah tersimpan di server, kiriman dari antrean
    // memakai kunci yang sama sehingga tidak tercatat dua kali.
    expect(store.offline.pending.single.clientRef, refs.single);
  });

  testWidgets('menu: antrean terkirim otomatis & daftar barang diperbarui', (tester) async {
    final store = await freshStore();
    await store.offline.enqueue(queued('a', Mode.inbound, 2));
    final paths = <String>[];
    final api = ApiClient(
      store,
      MockClient((request) async {
        paths.add(request.url.path);
        if (request.url.path == '/api/catalog') {
          return http.Response(
            jsonEncode({
              'success': true,
              'data': [
                {...product.toJson(), 'qr_token': token},
              ],
            }),
            200,
          );
        }
        return recorded(jsonDecode(request.body) as Map<String, dynamic>);
      }),
    );
    await tester.pumpWidget(MaterialApp(home: HomeScreen(api: api)));
    expect(find.byKey(const Key('pending-banner')), findsOneWidget);
    await tester.pumpAndSettle();
    expect(paths, ['/api/transactions', '/api/catalog']);
    expect(find.byKey(const Key('pending-banner')), findsNothing);
    expect(find.text('1 transaksi offline terkirim.'), findsOneWidget);
    expect(find.textContaining('Data barang di HP: 1 barang'), findsOneWidget);
    await tester.pumpWidget(const SizedBox()); // hentikan timer menu
  });

  testWidgets('menu: transaksi ditolak server tampil untuk dicek', (tester) async {
    final store = await freshStore();
    await store.offline.saveCatalog({token: product});
    await store.offline.enqueue(queued('x', Mode.outbound, 50, reservation: '0012345'));
    final api = ApiClient(
      store,
      MockClient((_) async => failure('STOCK_NOT_ENOUGH', 'Stok tidak mencukupi. Stok tersedia: 10.', 409)),
    );
    await tester.pumpWidget(MaterialApp(home: HomeScreen(api: api)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('failed-banner')), findsOneWidget);
    await tester.tap(find.text('Lihat'));
    await tester.pumpAndSettle();
    expect(find.text('Stok tidak mencukupi. Stok tersedia: 10.'), findsOneWidget);
    await tester.tap(find.text('Hapus'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Hapus'));
    await tester.pumpAndSettle();
    expect(store.offline.failed, isEmpty);
    expect(find.text('Semua transaksi sudah terkirim.'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}
