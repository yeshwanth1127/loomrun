import 'package:flutter/material.dart';

import '../../core/auth/auth.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_logo.dart';

const _mono = 'monospace';

enum _AuthMode { logIn, signIn }

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _formKey = GlobalKey<FormState>();
  final _fullName = TextEditingController();
  final _organization = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirmPassword = TextEditingController();
  bool _submitting = false;

  _AuthMode _mode = _AuthMode.logIn;
  bool _obscurePassword = true;
  bool _obscureConfirm = true;

  bool get _isSignIn => _mode == _AuthMode.signIn;

  @override
  void dispose() {
    _fullName.dispose();
    _organization.dispose();
    _email.dispose();
    _password.dispose();
    _confirmPassword.dispose();
    super.dispose();
  }

  void _switchMode(_AuthMode mode) {
    setState(() {
      _mode = mode;
      _formKey.currentState?.reset();
    });
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;
    if (_submitting) return;

    setState(() => _submitting = true);
    final String? error;
    try {
      if (_isSignIn) {
        error = await authController.signIn(
          fullName: _fullName.text,
          email: _email.text,
          password: _password.text,
          confirmPassword: _confirmPassword.text,
          organizationName: _organization.text,
        );
      } else {
        error = await authController.logIn(
          email: _email.text,
          password: _password.text,
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }

    if (!mounted) return;
    if (error != null) _showError(error);
    // On success authController notifies listeners and the root
    // ListenableBuilder swaps in Home.
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          backgroundColor: AppColors.inverseSurface,
          behavior: SnackBarBehavior.floating,
          content: Row(
            children: [
              const Icon(Icons.error_outline,
                  size: 18, color: AppColors.inverseOnSurface),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  message,
                  style: const TextStyle(
                    color: AppColors.inverseOnSurface,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
  }

  void _forgotPassword() {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('Forgot Password'),
        content: const Text(
          'Password recovery is not available in the app yet. '
          'Reset your password from the web app, or contact your admin.',
          style: TextStyle(fontSize: 14, height: 1.5),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 32, 24, 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const AppLogo(height: 36),
                    const SizedBox(height: 40),
                    Text(
                      _isSignIn ? 'Sign in' : 'Log in',
                      style: AppTypography.heading(fontSize: 28),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _isSignIn
                          ? 'Create your account to get started.'
                          : 'Welcome back. Enter your details to continue.',
                      style: const TextStyle(
                        fontSize: 14,
                        color: AppColors.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 32),

                    if (_isSignIn) ...[
                      _field(
                        controller: _fullName,
                        label: 'Full Name',
                        textInputAction: TextInputAction.next,
                        textCapitalization: TextCapitalization.words,
                        validator: (v) => (v == null || v.trim().isEmpty)
                            ? 'Enter your full name.'
                            : null,
                      ),
                      const SizedBox(height: 20),
                      _field(
                        controller: _organization,
                        label: 'Organization',
                        textInputAction: TextInputAction.next,
                        textCapitalization: TextCapitalization.words,
                        validator: (v) => (v == null || v.trim().isEmpty)
                            ? 'Enter your organization name.'
                            : null,
                      ),
                      const SizedBox(height: 20),
                    ],

                    _field(
                      controller: _email,
                      label: 'Email ID',
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      validator: (v) {
                        final value = (v ?? '').trim();
                        if (value.isEmpty) return 'Enter your Email ID.';
                        final ok = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
                            .hasMatch(value);
                        return ok ? null : 'Enter a valid Email ID.';
                      },
                    ),
                    const SizedBox(height: 20),

                    _field(
                      controller: _password,
                      label: 'Password',
                      obscureText: _obscurePassword,
                      textInputAction: _isSignIn
                          ? TextInputAction.next
                          : TextInputAction.done,
                      onFieldSubmitted: _isSignIn ? null : (_) => _submit(),
                      suffixIcon: _visibilityToggle(
                        _obscurePassword,
                        () => setState(
                            () => _obscurePassword = !_obscurePassword),
                      ),
                      validator: (v) {
                        final value = v ?? '';
                        if (value.isEmpty) return 'Enter your password.';
                        if (_isSignIn && value.length < 8) {
                          return 'Password must be at least 8 characters.';
                        }
                        return null;
                      },
                    ),

                    if (_isSignIn) ...[
                      const SizedBox(height: 20),
                      _field(
                        controller: _confirmPassword,
                        label: 'Confirm Password',
                        obscureText: _obscureConfirm,
                        textInputAction: TextInputAction.done,
                        onFieldSubmitted: (_) => _submit(),
                        suffixIcon: _visibilityToggle(
                          _obscureConfirm,
                          () => setState(
                              () => _obscureConfirm = !_obscureConfirm),
                        ),
                        validator: (v) {
                          if ((v ?? '').isEmpty) {
                            return 'Confirm your password.';
                          }
                          if (v != _password.text) {
                            return 'Passwords do not match.';
                          }
                          return null;
                        },
                      ),
                    ],

                    if (!_isSignIn) ...[
                      const SizedBox(height: 12),
                      Align(
                        alignment: Alignment.centerRight,
                        child: GestureDetector(
                          onTap: _forgotPassword,
                          child: const Text(
                            'Forgot Password',
                            style: TextStyle(
                              fontFamily: _mono,
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: AppColors.primary,
                            ),
                          ),
                        ),
                      ),
                    ],

                    const SizedBox(height: 32),
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: FilledButton(
                        style: FilledButton.styleFrom(
                          backgroundColor: AppColors.primary,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                        onPressed: _submitting ? null : _submit,
                        child: _submitting
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : Text(
                                _isSignIn ? 'SIGN IN' : 'LOG IN',
                                style: const TextStyle(
                                  fontFamily: _mono,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                  letterSpacing: 1,
                                ),
                              ),
                      ),
                    ),

                    const SizedBox(height: 24),
                    Center(
                      child: Wrap(
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(
                            _isSignIn
                                ? 'Already registered?  '
                                : 'New to Loom Run?  ',
                            style: const TextStyle(
                              fontSize: 13,
                              color: AppColors.onSurfaceVariant,
                            ),
                          ),
                          GestureDetector(
                            onTap: () => _switchMode(
                              _isSignIn ? _AuthMode.logIn : _AuthMode.signIn,
                            ),
                            child: Text(
                              _isSignIn ? 'LOG IN' : 'SIGN IN',
                              style: const TextStyle(
                                fontFamily: _mono,
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: AppColors.primary,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _field({
    required TextEditingController controller,
    required String label,
    String? Function(String?)? validator,
    TextInputType? keyboardType,
    TextInputAction? textInputAction,
    TextCapitalization textCapitalization = TextCapitalization.none,
    bool obscureText = false,
    Widget? suffixIcon,
    void Function(String)? onFieldSubmitted,
  }) {
    return TextFormField(
      controller: controller,
      validator: validator,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      textCapitalization: textCapitalization,
      obscureText: obscureText,
      onFieldSubmitted: onFieldSubmitted,
      style: const TextStyle(fontSize: 15, color: AppColors.onSurface),
      cursorColor: AppColors.primary,
      decoration: InputDecoration(
        labelText: label,
        isDense: true,
        contentPadding: const EdgeInsets.only(bottom: 8),
        labelStyle: const TextStyle(
          fontSize: 14,
          color: AppColors.onSurfaceVariant,
        ),
        floatingLabelStyle: const TextStyle(
          fontSize: 13,
          color: AppColors.primary,
        ),
        suffixIcon: suffixIcon,
        suffixIconConstraints: const BoxConstraints(minWidth: 40, minHeight: 24),
        enabledBorder: const UnderlineInputBorder(
          borderSide: BorderSide(color: AppColors.outlineVariant),
        ),
        focusedBorder: const UnderlineInputBorder(
          borderSide: BorderSide(color: AppColors.primary, width: 2),
        ),
        errorBorder: const UnderlineInputBorder(
          borderSide: BorderSide(color: AppColors.error),
        ),
        focusedErrorBorder: const UnderlineInputBorder(
          borderSide: BorderSide(color: AppColors.error, width: 2),
        ),
        errorStyle: const TextStyle(color: AppColors.error, fontSize: 12),
      ),
    );
  }

  Widget _visibilityToggle(bool obscured, VoidCallback onTap) {
    return IconButton(
      onPressed: onTap,
      visualDensity: VisualDensity.compact,
      icon: Icon(
        obscured ? Icons.visibility_off_outlined : Icons.visibility_outlined,
        size: 18,
        color: AppColors.outline,
      ),
    );
  }
}
