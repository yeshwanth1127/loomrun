import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/widgets/app_logo.dart';
import 'auth_screen.dart';

/// Shows the NOOLRUN logo for 2 seconds, then fades into [AuthScreen].
class SplashGate extends StatefulWidget {
  const SplashGate({super.key});

  @override
  State<SplashGate> createState() => _SplashGateState();
}

class _SplashGateState extends State<SplashGate> {
  static const _hold = Duration(seconds: 2);
  static const _fade = Duration(milliseconds: 550);

  bool _showSplash = true;

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(_hold, () {
      if (!mounted) return;
      setState(() => _showSplash = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: _fade,
      switchInCurve: Curves.easeOut,
      switchOutCurve: Curves.easeIn,
      transitionBuilder: (child, animation) {
        return FadeTransition(opacity: animation, child: child);
      },
      child: _showSplash
          ? const _SplashView(key: ValueKey('splash'))
          : const AuthScreen(key: ValueKey('auth')),
    );
  }
}

class _SplashView extends StatelessWidget {
  const _SplashView({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: AppColors.surface,
      body: Center(
        child: AppLogo(height: 48),
      ),
    );
  }
}
