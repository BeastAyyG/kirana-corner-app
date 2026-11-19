import 'package:flutter/material.dart';

/// BigBasket "bbnow" design language, ported from the web design tokens.
class BB {
  static const Color green = Color(0xFF84C225);
  static const Color greenDark = Color(0xFF4C8C1C);
  static const Color greenDeep = Color(0xFF345D1C);
  static const Color greenTint = Color(0xFFF2F8E8);
  static const Color headerTint = Color(0xFFE7F3D0);
  static const Color lime = Color(0xFFA6CE39);
  static const Color red = Color(0xFFF61B2C);
  static const Color redTint = Color(0xFFFDEAEA);
  static const Color amber = Color(0xFFF5A623);
  static const Color amberTint = Color(0xFFFFF6E3);
  static const Color blue = Color(0xFF3D7BD9);
  static const Color blueTint = Color(0xFFEAF2FD);
  static const Color ink = Color(0xFF231F20);
  static const Color sub = Color(0xFF757575);
  static const Color faint = Color(0xFFA5A5A5);
  static const Color line = Color(0xFFECECEC);
  static const Color bg = Color(0xFFF4F4F2);
  static const Color card = Color(0xFFFFFFFF);
  static const Color cart = Color(0xFF0C3B1E);
  static const Color stepperTint = Color(0xFFD9EFD0);
  static const Color saveTint = Color(0xFFE9F7EE);
  static const Color saveInk = Color(0xFF1E7A3C);
  static const Color etaBlue = Color(0xFF2F6FED);
  static const Color flag = Color(0xFF1E9E4A);

  static const double radius = 12;
  static const double radiusLg = 16;
  static const double tabbarH = 58;

  static const List<BoxShadow> shadow = [
    BoxShadow(color: Color(0x14231F20), blurRadius: 10, offset: Offset(0, 2)),
  ];
  static const List<BoxShadow> shadowLg = [
    BoxShadow(color: Color(0x29231F20), blurRadius: 30, offset: Offset(0, 10)),
  ];
}

ThemeData buildTheme() {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    colorScheme: ColorScheme.fromSeed(
      seedColor: BB.green,
      primary: BB.green,
      secondary: BB.greenDeep,
      surface: BB.card,
      error: BB.red,
    ),
    scaffoldBackgroundColor: BB.bg,
    fontFamily: 'Roboto',
  );
  return base.copyWith(
    appBarTheme: const AppBarTheme(
      backgroundColor: BB.card,
      foregroundColor: BB.ink,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(color: BB.ink, fontSize: 17, fontWeight: FontWeight.w800),
    ),
    cardTheme: CardThemeData(
      color: BB.card,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BB.radius)),
      margin: EdgeInsets.zero,
    ),
    dividerTheme: const DividerThemeData(color: BB.line, thickness: 1, space: 1),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: BB.card,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BB.radius),
        borderSide: const BorderSide(color: BB.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BB.radius),
        borderSide: const BorderSide(color: BB.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BB.radius),
        borderSide: const BorderSide(color: BB.green, width: 1.5),
      ),
      hintStyle: const TextStyle(color: BB.faint, fontSize: 14),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: BB.green,
        foregroundColor: Colors.white,
        elevation: 0,
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BB.radius)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: BB.greenDark,
        side: const BorderSide(color: BB.green),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BB.radius)),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: BB.greenDark),
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: BB.card,
      selectedItemColor: BB.greenDark,
      unselectedItemColor: BB.faint,
      type: BottomNavigationBarType.fixed,
      selectedLabelStyle: TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
      unselectedLabelStyle: TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
      elevation: 8,
    ),
    snackBarTheme: const SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: BB.ink,
      contentTextStyle: TextStyle(color: Colors.white, fontSize: 13.5),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: BB.green),
  );
}