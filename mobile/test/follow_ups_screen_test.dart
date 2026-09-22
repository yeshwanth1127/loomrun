import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:loom_run/features/crm/follow_ups_controller.dart';
import 'package:loom_run/features/crm/follow_ups_screen.dart';

void main() {
  setUp(() => followUpsController.query = '');

  // Give tests a tall phone-sized viewport so list content is on screen.
  Future<void> pump(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1200, 3200);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(const MaterialApp(home: FollowUpsScreen()));
    await tester.pumpAndSettle();
  }

  testWidgets('shows heading, metrics and tabs', (tester) async {
    await pump(tester);

    expect(find.text('Follow ups'), findsOneWidget);
    expect(find.textContaining('scheduled'), findsWidgets);

    for (final label in [
      'TOTAL FOLLOW UPS',
      'DUE TODAY',
      'OVERDUE',
      'UPCOMING',
      'CONVERSION FROM FOLLOW UPS',
    ]) {
      expect(find.text(label), findsOneWidget);
    }

    expect(find.textContaining('All follow ups'), findsOneWidget);
    expect(find.textContaining('Due today'), findsOneWidget);
  });

  testWidgets('All tab lists overdue and today entries', (tester) async {
    await pump(tester);

    expect(find.text('Nikhil Rao'), findsWidgets); // overdue entry
    expect(find.text('Sunita Desai'), findsWidgets); // today entry
    expect(find.textContaining('overdue'), findsWidgets); // overdue flagged
  });

  testWidgets('Due today tab filters to today', (tester) async {
    await pump(tester);

    await tester.tap(find.textContaining('Due today'));
    await tester.pumpAndSettle();

    expect(find.text('Sunita Desai'), findsWidgets);
    expect(find.text('Nikhil Rao'), findsNothing); // overdue person hidden
  });

  testWidgets('tapping a follow-up opens the related lead', (tester) async {
    await pump(tester);

    await tester.tap(find.text('Sunita Desai').first);
    await tester.pumpAndSettle();

    expect(find.text('Lead Details'), findsOneWidget);
  });

  testWidgets('search filters entries', (tester) async {
    await pump(tester);

    await tester.enterText(find.byType(TextField), 'Nikhil');
    await tester.pumpAndSettle();

    expect(find.text('Nikhil Rao'), findsWidgets);
    expect(find.text('Sunita Desai'), findsNothing);
  });

  testWidgets('Schedule follow-up form opens', (tester) async {
    await pump(tester);

    await tester.tap(
        find.widgetWithText(FloatingActionButton, 'Schedule follow-up'));
    await tester.pumpAndSettle();

    expect(find.text('Schedule follow-up'), findsWidgets);
    expect(find.text('Action / notes'), findsOneWidget);
  });
}
