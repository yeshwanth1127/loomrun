import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:loom_run/features/crm/leads_controller.dart';
import 'package:loom_run/features/crm/leads_screen.dart';

void main() {
  setUp(() => leadsController.setFilters(const LeadFilters()));

  Future<void> pump(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1200, 3200);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(const MaterialApp(home: LeadsScreen()));
    await tester.pumpAndSettle();
  }

  testWidgets('board shows the Loom Run pipeline stages', (tester) async {
    await pump(tester);

    expect(find.text('Leads'), findsOneWidget);
    for (final stage in [
      'New',
      'Contacted',
      'Requirement Collected',
      'Quoted',
      'Negotiation',
    ]) {
      expect(find.text(stage), findsWidgets);
    }
    expect(find.text('Won'), findsNothing); // hidden until "Show closed"

    expect(find.text('Raghu'), findsWidgets);
    expect(find.text('Exora Solutions'), findsWidgets);
  });

  testWidgets('tapping a stage tab does not crash and keeps its leads',
      (tester) async {
    await pump(tester);

    await tester.tap(find.text('Contacted').first);
    await tester.pumpAndSettle();

    expect(find.text('Sunita Desai'), findsWidgets);
  });

  testWidgets('Show closed reveals Won / Lost columns', (tester) async {
    await pump(tester);

    expect(find.text('Won'), findsNothing);
    expect(find.text('Lost'), findsNothing);

    await tester.tap(find.text('Show closed (2)'));
    await tester.pumpAndSettle();

    expect(find.text('Won'), findsWidgets);
    expect(find.text('Lost'), findsWidgets);
  });

  testWidgets('tapping a lead opens details', (tester) async {
    await pump(tester);

    await tester.tap(find.text('Raghu').first);
    await tester.pumpAndSettle();

    expect(find.text('Lead Details'), findsOneWidget);
  });

  testWidgets('Table view lists leads', (tester) async {
    await pump(tester);

    await tester.tap(find.text('Table'));
    await tester.pumpAndSettle();

    expect(find.text('LEAD'), findsOneWidget);
    expect(find.text('Raghu'), findsWidgets);
    expect(find.text('Sunita Desai'), findsWidgets);
  });

  testWidgets('Add Lead form opens', (tester) async {
    await pump(tester);

    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();

    expect(find.text('Add Lead'), findsWidgets);
    expect(find.text('Name'), findsWidgets);
  });

  testWidgets('search is always visible and filters the board', (tester) async {
    await pump(tester);

    // No toggle needed — the field is on screen immediately.
    expect(find.byType(TextField), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'Raghu');
    await tester.pumpAndSettle();

    expect(find.text('Raghu'), findsWidgets);
    await tester.tap(find.text('Contacted').first);
    await tester.pumpAndSettle();
    expect(find.text('Sunita Desai'), findsNothing); // filtered out by search
  });

  testWidgets('Show closed also reveals closed leads in Table view',
      (tester) async {
    await pump(tester);

    await tester.tap(find.text('Table'));
    await tester.pumpAndSettle();
    expect(find.text('Farah Khan'), findsNothing); // closed, hidden by default

    await tester.tap(find.text('Show closed (2)'));
    await tester.pumpAndSettle();

    expect(find.text('Farah Khan'), findsWidgets); // now visible
  });
}
