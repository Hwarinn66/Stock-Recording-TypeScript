import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:warehouse_scanner/api.dart';
import 'package:warehouse_scanner/session_store.dart';
import 'package:warehouse_scanner/validators.dart';

const token = '550e8400-e29b-41d4-a716-446655440001';

Future<SessionStore> freshStore() async {
  SharedPreferences.setMockInitialValues({'server_url': 'https://10.0.0.5:3000'});
  return SessionStore.load();
}

void main() {
  test('server URL normalization', () {
    expect(normalizeServerUrl(' 10.0.0.5:3000/ '), 'https://10.0.0.5:3000');
    expect(normalizeServerUrl('http://pc:3000'), 'http://pc:3000');
    expect(validateServerUrl(''), isNotNull);
    expect(validateServerUrl('https://192.168.1.10:3000'), isNull);
  });

  test('quantity must be positive and within stock for OUT', () {
    expect(validateQuantity(''), isNotNull);
    expect(validateQuantity('0'), isNotNull);
    expect(validateQuantity('5'), isNull);
    expect(validateQuantity('2147483648'), isNotNull);
    expect(validateQuantity('11', stock: 10), contains('Stok tersedia: 10'));
    expect(validateQuantity('10', stock: 10), isNull);
  });

  test('Kg boleh berkoma (maks. 3 desimal) tanpa pembulatan, satuan lain bulat', () {
    expect(allowsDecimal('Kg'), isTrue);
    expect(allowsDecimal('K g'), isTrue);
    expect(allowsDecimal('PCS'), isFalse);
    expect(parseQuantity('2,5', decimal: true), 2.5);
    expect(parseQuantity('2.125', decimal: true), 2.125);
    expect(parseQuantity('2,5'), isNull);
    expect(parseQuantity('1.2345', decimal: true), isNull);
    expect(validateQuantity('2,5'), isNotNull);
    expect(validateQuantity('0,3', stock: 548.8, decimal: true), isNull);
    expect(
      validateQuantity('548,9', stock: 548.8, decimal: true),
      contains('Stok tersedia: 548.8'),
    );
    expect(validateQuantity('0,000', decimal: true), 'Isi jumlah lebih dari 0.');
    expect(formatQty(roundStock(548.8 - 0.3)), '548.5');
    expect(formatQty(roundStock(0.1 + 0.2)), '0.3');
    expect(formatQty(1159.53), '1159.53');
    expect(formatQty(18), '18');
    expect(formatQty(18.0), '18');
  });

  test('reservation must be exactly 7 digits', () {
    expect(validateReservation('0012345'), isNull);
    for (final bad in ['', '123456', '12345678', '12a4567']) {
      expect(validateReservation(bad), isNotNull, reason: bad);
    }
  });

  test('cookies parsed from folded Set-Cookie header with Expires commas', () async {
    final store = await freshStore();
    await store.saveCookies(
      'warehouse_session=abc123; Path=/; Expires=Fri, 23 Oct 2026 13:48:58 GMT; HttpOnly,'
      'warehouse_device=def456; Path=/; Expires=Thu, 21 Jan 2027 01:48:58 GMT; HttpOnly',
    );
    expect(store.cookieHeader, 'warehouse_session=abc123; warehouse_device=def456');
    await store.clearSession();
    // Cookie perangkat dipertahankan setelah logout.
    expect(store.cookieHeader, 'warehouse_device=def456');
  });

  test('lookup sends mode + cookie and parses product', () async {
    final store = await freshStore();
    await store.saveCookies('warehouse_session=aa');
    late http.Request seen;
    final api = ApiClient(
      store,
      MockClient((request) async {
        seen = request;
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'id': 3,
              'sku': 'PB1A00003',
              'name': 'U-RING',
              'unit': 'PCS',
              'stock': 99,
              'location_code': 'A.01.03',
              'room_name': 'Ruangan 1',
            },
          }),
          200,
        );
      }),
    );
    final product = await api.lookup(token, Mode.outbound);
    expect(seen.url.toString(), 'https://10.0.0.5:3000/api/scan/$token?mode=OUT');
    expect(seen.headers['Cookie'], 'warehouse_session=aa');
    expect(product.stock, 99);
    expect(product.place, 'Ruangan 1 · A.01.03');
  });

  test('record sends reservation only for OUT', () async {
    final store = await freshStore();
    final bodies = <Map<String, dynamic>>[];
    final api = ApiClient(
      store,
      MockClient((request) async {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        bodies.add(body);
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'transaction_number': 'OUT-20261023-0001',
              'quantity': body['quantity'],
              'stock_before': 99,
              'stock_after': 96,
              'reservation_number': body['reservation_number'],
              'product': {
                'id': 3,
                'sku': 'PB1A00003',
                'name': 'U-RING',
                'unit': 'PCS',
                'stock': 99,
                'location_code': 'A.01.03',
                'room_name': null,
              },
            },
          }),
          200,
        );
      }),
    );
    await api.record(token: token, mode: Mode.inbound, quantity: 3);
    final out = await api.record(
      token: token,
      mode: Mode.outbound,
      quantity: 3,
      reservationNumber: '0012345',
    );
    expect(bodies[0].containsKey('reservation_number'), isFalse);
    expect(bodies[1]['reservation_number'], '0012345');
    expect(bodies[1]['quantity'], 3);
    expect(out.reservationNumber, '0012345');
  });

  test('stok & jumlah berkoma dari server dibaca apa adanya', () {
    final result = TransactionResult.fromJson({
      'transaction_number': 'OUT-20261023-0002',
      'quantity': 0.3,
      'stock_before': 548.8,
      'stock_after': 548.5,
      'reservation_number': '0012345',
      'product': {
        'id': 9,
        'sku': 'CB4A60001',
        'name': 'WELDING;ELECTRODE',
        'unit': 'Kg',
        'stock': 548.5,
        'location_code': 'B.05.05.008',
        'room_name': 'Ruangan 1',
      },
    });
    expect(result.quantity, 0.3);
    expect(result.stockBefore, 548.8);
    expect(result.product.stock, 548.5);
  });

  test('validation error shows field message; 401 clears session', () async {
    final store = await freshStore();
    await store.saveCookies('warehouse_session=aa');
    final api = ApiClient(
      store,
      MockClient((request) async {
        if (request.url.path.endsWith('/transactions')) {
          return http.Response(
            jsonEncode({
              'success': false,
              'code': 'VALIDATION_ERROR',
              'message': 'Input tidak valid',
              'details': {
                'formErrors': [],
                'fieldErrors': {
                  'reservation_number': ['No reservasi wajib untuk barang keluar.'],
                },
              },
            }),
            422,
          );
        }
        return http.Response(
          jsonEncode({'success': false, 'code': 'UNAUTHORIZED', 'message': 'Silakan login dahulu.'}),
          401,
        );
      }),
    );
    await expectLater(
      api.record(token: token, mode: Mode.outbound, quantity: 1),
      throwsA(isA<ApiException>().having((e) => e.message, 'message', 'No reservasi wajib untuk barang keluar.')),
    );
    await expectLater(
      api.me(),
      throwsA(isA<ApiException>().having((e) => e.unauthorized, 'unauthorized', isTrue)),
    );
    expect(store.hasSession, isFalse);
  });

  test('non-JSON response explains server address problem', () async {
    final store = await freshStore();
    final api = ApiClient(store, MockClient((_) async => http.Response('<html>', 404)));
    await expectLater(
      api.me(),
      throwsA(isA<ApiException>().having((e) => e.message, 'message', contains('Periksa alamat server'))),
    );
  });
}
