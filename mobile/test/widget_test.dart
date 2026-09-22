import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:loom_run/core/auth/auth.dart';
import 'package:loom_run/core/auth/mock/account_store.dart';
import 'package:loom_run/core/auth/mock/mock_auth_service.dart';
import 'package:loom_run/main.dart';

void main() {
  // A persistent store that outlives an individual service instance, so we can
  // simulate quitting and relaunching the app.
  late InMemoryAccountStore store;

  setUp(() {
    store = InMemoryAccountStore();
    debugSetAuthService(MockAuthService(store: store));
  });

  Future<void> launch(WidgetTester tester) async {
    debugSetAuthService(MockAuthService(store: store)); // fresh session
    await authController.init();
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(const LoomRunApp());
    await tester.pumpAndSettle();
  }

  Future<void> signUp(WidgetTester tester) async {
    await tester.tap(find.text('SIGN IN').last);
    await tester.pumpAndSettle();
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Full Name'), 'Asha Menon');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Email ID'), 'asha@example.com');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Password'), 'secret1');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Confirm Password'), 'secret1');
    await tester.tap(find.widgetWithText(FilledButton, 'SIGN IN'));
    await tester.pumpAndSettle();
  }

  Future<void> logIn(WidgetTester tester, String email, String password) async {
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Email ID'), email);
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Password'), password);
    await tester.tap(find.widgetWithText(FilledButton, 'LOG IN'));
    await tester.pumpAndSettle();
  }

  testWidgets('starts on the log in screen', (tester) async {
    await launch(tester);
    expect(find.text('Log in'), findsOneWidget);
    expect(find.text('Forgot Password'), findsOneWidget);
  });

  testWidgets('switching to sign in shows the registration fields',
      (tester) async {
    await launch(tester);
    await tester.tap(find.text('SIGN IN').last);
    await tester.pumpAndSettle();
    expect(find.text('Full Name'), findsOneWidget);
    expect(find.text('Confirm Password'), findsOneWidget);
  });

  testWidgets('sign in lands on Home with dynamic user details',
      (tester) async {
    await launch(tester);
    await signUp(tester);
    expect(find.textContaining('Asha'), findsWidgets);
    expect(find.text('AM'), findsOneWidget);
    expect(find.text('Follow-ups due'), findsOneWidget);
  });

  testWidgets('account persists across restart; session does not',
      (tester) async {
    await launch(tester);
    await signUp(tester);
    expect(find.text('Follow-ups due'), findsOneWidget);

    // Quit + relaunch.
    await launch(tester);

    expect(find.text('Log in'), findsOneWidget); // not auto-logged-in
    expect(find.text('Follow-ups due'), findsNothing);
    expect(authController.hasAccount('asha@example.com'), isTrue);

    await logIn(tester, 'asha@example.com', 'wrongpass');
    expect(find.text('Incorrect password.'), findsOneWidget);

    await logIn(tester, 'nobody@example.com', 'whatever');
    expect(find.text('No account found. Please sign in.'), findsOneWidget);

    await logIn(tester, 'asha@example.com', 'secret1');
    expect(find.text('Follow-ups due'), findsOneWidget);
  });

  testWidgets('log out ends the session but keeps the account',
      (tester) async {
    await launch(tester);
    await signUp(tester);

    await tester.tap(find.text('AM'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Log out'));
    await tester.pumpAndSettle();

    expect(find.text('Log in'), findsOneWidget);
    expect(authController.hasAccount('asha@example.com'), isTrue);

    await logIn(tester, 'asha@example.com', 'secret1');
    expect(find.text('Follow-ups due'), findsOneWidget);
  });
}
