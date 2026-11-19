import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'core/app_router.dart';
import 'core/config.dart';
import 'core/providers.dart';
import 'core/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('en_IN');
  await initializeDateFormatting('en_GB');
  await AppConfig.load();
  runApp(const ProviderScope(child: KiranaApp()));
}

class KiranaApp extends ConsumerStatefulWidget {
  const KiranaApp({super.key});
  @override
  ConsumerState<KiranaApp> createState() => _KiranaAppState();
}

class _KiranaAppState extends ConsumerState<KiranaApp> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(sessionProvider.notifier).bootstrap());
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'Kirana Corner',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      routerConfig: router,
    );
  }
}