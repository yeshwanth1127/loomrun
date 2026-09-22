import 'package:flutter/material.dart';

/// The official NOOLRUN wordmark. Use this everywhere the app previously
/// rendered "LOOM RUN" as text, so the brand mark stays consistent.
class AppLogo extends StatelessWidget {
  final double height;

  const AppLogo({super.key, this.height = 22});

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/branding/noolrun_logo.png',
      height: height,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.high,
      isAntiAlias: true,
    );
  }
}
