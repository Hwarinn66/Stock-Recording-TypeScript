import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'session_store.dart';
import 'ui.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = await SessionStore.load();
  List<int>? certificate;
  try {
    certificate = (await rootBundle.load('assets/certs/rootCA.crt'))
        .buffer
        .asUint8List();
  } catch (_) {
    certificate = null;
  }
  final api = ApiClient(store, createHttpClient(trustedCertificate: certificate));
  runApp(WarehouseScannerApp(api: api));
}

class WarehouseScannerApp extends StatelessWidget {
  const WarehouseScannerApp({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Warehouse Scanner',
      debugShowCheckedModeBanner: false,
      navigatorObservers: [routeObserver],
      theme: buildTheme(),
      home: StartupScreen(api: api),
    );
  }
}

/// Memeriksa sesi tersimpan: langsung ke menu bila masih login.
class StartupScreen extends StatefulWidget {
  const StartupScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<StartupScreen> createState() => _StartupScreenState();
}

class _StartupScreenState extends State<StartupScreen> {
  @override
  void initState() {
    super.initState();
    _route();
  }

  Future<void> _route() async {
    final api = widget.api;
    Widget next = LoginScreen(api: api);
    if (api.store.serverUrl.isNotEmpty && api.store.hasSession) {
      try {
        await api.me();
        next = HomeScreen(api: api);
      } on ApiException catch (error) {
        // Server tidak terjangkau: tetap ke menu agar scan offline (antrean di HP) bisa dipakai.
        next = error.unavailable
            ? HomeScreen(api: api)
            : LoginScreen(
                api: api,
                notice: error.unauthorized ? 'Sesi berakhir. Silakan login lagi.' : error.message,
              );
      }
    }
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(builder: (_) => next),
    );
  }

  @override
  Widget build(BuildContext context) =>
      const Scaffold(body: Center(child: CircularProgressIndicator()));
}
