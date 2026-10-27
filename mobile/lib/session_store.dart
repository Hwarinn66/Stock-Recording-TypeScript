import 'package:shared_preferences/shared_preferences.dart';

import 'offline.dart';

/// Menyimpan alamat server dan cookie login di penyimpanan privat aplikasi.
class SessionStore {
  SessionStore(this._prefs);

  static Future<SessionStore> load() async =>
      SessionStore(await SharedPreferences.getInstance());

  final SharedPreferences _prefs;
  /// Daftar barang & antrean offline; tidak ikut terhapus saat logout.
  late final offline = OfflineStore(_prefs);

  static const _serverKey = 'server_url';
  static const _userKey = 'username';
  static const _sessionKey = 'session_cookie';
  // Cookie perangkat tetap disimpan setelah logout: server memberi kuota login
  // sendiri untuk perangkat ini sehingga tidak ikut terkunci oleh percobaan lain.
  static const _deviceKey = 'device_cookie';
  static final _cookiePattern = RegExp(
    r'(warehouse_session|warehouse_device)=([0-9a-f]+)',
  );

  String get serverUrl => _prefs.getString(_serverKey) ?? '';
  String? get username => _prefs.getString(_userKey);
  bool get hasSession => _prefs.getString(_sessionKey) != null;

  String? get cookieHeader {
    final session = _prefs.getString(_sessionKey);
    final device = _prefs.getString(_deviceKey);
    final parts = [
      if (session != null) 'warehouse_session=$session',
      if (device != null) 'warehouse_device=$device',
    ];
    return parts.isEmpty ? null : parts.join('; ');
  }

  Future<void> setServerUrl(String value) => _prefs.setString(_serverKey, value);
  Future<void> setUsername(String value) => _prefs.setString(_userKey, value);

  /// Paket http menggabungkan beberapa Set-Cookie dengan koma (dan atribut
  /// Expires juga berisi koma), jadi nilai cookie diambil dengan regex.
  Future<void> saveCookies(String? setCookieHeader) async {
    if (setCookieHeader == null) return;
    for (final match in _cookiePattern.allMatches(setCookieHeader)) {
      final key = match.group(1) == 'warehouse_session' ? _sessionKey : _deviceKey;
      await _prefs.setString(key, match.group(2)!);
    }
  }

  Future<void> clearSession() async {
    await _prefs.remove(_sessionKey);
    await _prefs.remove(_userKey);
  }
}
