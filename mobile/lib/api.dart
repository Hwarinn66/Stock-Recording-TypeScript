import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

import 'session_store.dart';

enum Mode {
  inbound('IN', 'Barang Masuk'),
  outbound('OUT', 'Barang Keluar');

  const Mode(this.code, this.label);
  final String code;
  final String label;
  bool get needsReservation => this == Mode.outbound;
}

class ApiException implements Exception {
  ApiException(this.message, {this.code, this.status = 0});
  final String message;
  final String? code;
  final int status;
  bool get unauthorized => status == 401;
  @override
  String toString() => message;
}

class Product {
  Product({
    required this.id,
    required this.sku,
    required this.name,
    required this.unit,
    required this.stock,
    required this.locationCode,
    this.roomName,
  });

  factory Product.fromJson(Map<String, dynamic> json) => Product(
    id: json['id'] as int,
    sku: json['sku'] as String,
    name: json['name'] as String,
    unit: json['unit'] as String,
    stock: json['stock'] as num,
    locationCode: json['location_code'] as String,
    roomName: json['room_name'] as String?,
  );

  final int id;
  final String sku;
  final String name;
  final String unit;
  final num stock;
  final String locationCode;
  final String? roomName;

  String get place =>
      roomName == null ? locationCode : '$roomName · $locationCode';
}

class TransactionResult {
  TransactionResult({
    required this.transactionNumber,
    required this.quantity,
    required this.stockBefore,
    required this.stockAfter,
    required this.product,
    this.reservationNumber,
  });

  factory TransactionResult.fromJson(Map<String, dynamic> json) =>
      TransactionResult(
        transactionNumber: json['transaction_number'] as String,
        quantity: json['quantity'] as num,
        stockBefore: json['stock_before'] as num,
        stockAfter: json['stock_after'] as num,
        reservationNumber: json['reservation_number'] as String?,
        product: Product.fromJson(json['product'] as Map<String, dynamic>),
      );

  final String transactionNumber;
  final num quantity;
  final num stockBefore;
  final num stockAfter;
  final String? reservationNumber;
  final Product product;
}

/// Klien HTTP yang mempercayai CA sistem + CA mkcert server gudang.
http.Client createHttpClient({List<int>? trustedCertificate}) {
  final context = SecurityContext(withTrustedRoots: true);
  if (trustedCertificate != null) {
    try {
      context.setTrustedCertificatesBytes(trustedCertificate);
    } on TlsException {
      // Sertifikat sudah dipercaya / format tidak valid: tetap pakai CA sistem.
    }
  }
  return IOClient(
    HttpClient(context: context)
      ..connectionTimeout = const Duration(seconds: 10),
  );
}

class ApiClient {
  ApiClient(this.store, this._client);

  final SessionStore store;
  final http.Client _client;
  static const _timeout = Duration(seconds: 20);

  Future<void> login(String username, String password) async {
    await _send('POST', 'auth/login', body: {
      'username': username,
      'password': password,
    });
    await store.setUsername(username);
  }

  Future<String> me() async {
    final data = await _send('GET', 'auth/me') as Map<String, dynamic>;
    return data['username'] as String;
  }

  Future<void> logout() async {
    try {
      await _send('POST', 'auth/logout', body: {});
    } finally {
      await store.clearSession();
    }
  }

  Future<Product> lookup(String token, Mode mode) async {
    final data = await _send(
      'GET',
      'scan/${Uri.encodeComponent(token)}',
      query: {'mode': mode.code},
    );
    return Product.fromJson(data as Map<String, dynamic>);
  }

  Future<TransactionResult> record({
    required String token,
    required Mode mode,
    required num quantity,
    String? reservationNumber,
  }) async {
    final data = await _send('POST', 'transactions', body: {
      'qr_token': token,
      'mode': mode.code,
      'quantity': quantity,
      'reservation_number': ?reservationNumber,
    });
    return TransactionResult.fromJson(data as Map<String, dynamic>);
  }

  Future<Object?> _send(
    String method,
    String path, {
    Map<String, Object?>? body,
    Map<String, String>? query,
  }) async {
    var uri = Uri.parse('${store.serverUrl}/api/$path');
    if (query != null) uri = uri.replace(queryParameters: query);
    final request = http.Request(method, uri)
      ..headers['Accept'] = 'application/json';
    final cookie = store.cookieHeader;
    if (cookie != null) request.headers['Cookie'] = cookie;
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }

    final http.Response response;
    try {
      response = await http.Response.fromStream(
        await _client.send(request).timeout(_timeout),
      );
    } on TimeoutException {
      throw ApiException(
        'Server tidak merespons. Periksa koneksi Wi-Fi lalu coba lagi.',
      );
    } catch (error) {
      throw ApiException(_connectionMessage(error));
    }

    await store.saveCookies(response.headers['set-cookie']);
    final Map<String, dynamic> json;
    try {
      json = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    } catch (_) {
      throw ApiException(
        'Respons server tidak dikenali (HTTP ${response.statusCode}). '
        'Periksa alamat server.',
        status: response.statusCode,
      );
    }
    if (response.statusCode >= 400 || json['success'] != true) {
      if (response.statusCode == 401 && path != 'auth/login') {
        await store.clearSession();
      }
      throw ApiException(
        _errorMessage(json),
        code: json['code'] as String?,
        status: response.statusCode,
      );
    }
    return json['data'];
  }

  String _connectionMessage(Object error) {
    final text = error.toString();
    if (error is HandshakeException ||
        text.contains('CERTIFICATE_VERIFY_FAILED') ||
        text.contains('HandshakeException')) {
      return 'Sertifikat HTTPS server tidak dipercaya. Pastikan alamat server '
          'memakai IP yang terdaftar di sertifikat (mis. 10.185.200.148).';
    }
    return 'Tidak dapat terhubung ke ${store.serverUrl}. Pastikan HP dan '
        'komputer di Wi-Fi yang sama dan server sedang berjalan.';
  }

  /// Untuk error validasi, tampilkan pesan field pertama (lebih spesifik).
  static String _errorMessage(Map<String, dynamic> json) {
    final details = json['details'];
    if (json['code'] == 'VALIDATION_ERROR' && details is Map) {
      final fields = details['fieldErrors'];
      if (fields is Map) {
        for (final messages in fields.values) {
          if (messages is List && messages.isNotEmpty) {
            return messages.first.toString();
          }
        }
      }
    }
    return json['message'] as String? ?? 'Permintaan gagal.';
  }
}
