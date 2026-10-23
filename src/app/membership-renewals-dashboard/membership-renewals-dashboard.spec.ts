import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminSession } from '../admin-dashboard/admin-session';
import { MembershipRenewalsDashboard } from './membership-renewals-dashboard';

describe('MembershipRenewalsDashboard', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MembershipRenewalsDashboard],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();
    TestBed.inject(AdminSession).authorization = 'Basic test';
  });

  it('builds an Excel-compatible CSV containing all renewal fields', () => {
    const fixture = TestBed.createComponent(MembershipRenewalsDashboard);
    const dashboard = fixture.componentInstance;
    dashboard['records'] = [
      {
        id: 'renewal-1',
        createdAt: '2026-10-23T10:00:00.000Z',
        email: 'member@example.com',
        membershipType: 'family',
        membershipNumber: '203',
        membershipHolderName: 'Test Member',
        memberAge: 40,
        spouseName: 'Test Spouse',
        spouseAge: 38,
        children: [{ name: 'Child, One', age: 10 }],
        otherFamilyMembers: '',
        address: '1 Test Street',
        postcode: 'SO1 1AA',
        phone: '07123456789',
        spousePhone: '07987654321',
        additionalPhones: '',
        consent: true,
      },
    ];

    const csv = dashboard['buildCsv']();

    expect(csv).toContain('"Membership number"');
    expect(csv).toContain('"203","Test Member","Family (£30)"');
    expect(csv).toContain('"member@example.com"');
    expect(csv).toContain('"Child, One (age 10)"');
    expect(csv).toContain('"Agreed"');
  });

  it('schedules a renewal clear after confirmation and records the schedule', async () => {
    const fixture = TestBed.createComponent(MembershipRenewalsDashboard);
    const dashboard = fixture.componentInstance;
    const schedule = {
      requestedAt: '2026-10-23T10:00:00.000Z',
      scheduledFor: '2026-11-02T10:00:00.000Z',
    };
    const fetchSpy = spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(
        new Response(JSON.stringify({ schedule }), { status: 201 }),
      ),
    );

    dashboard['requestClearAll']();
    expect(fetchSpy).not.toHaveBeenCalled();
    await dashboard['confirmDialogAction']();

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/admin/membership-renewals/clear-schedule',
      jasmine.objectContaining({ method: 'POST' }),
    );
    expect(dashboard['clearSchedule']).toEqual(schedule);
  });

  it('requests deletion only after confirmation', async () => {
    const fixture = TestBed.createComponent(MembershipRenewalsDashboard);
    const dashboard = fixture.componentInstance;
    const record = {
      id: 'a9e1d69a-05b1-4d95-89cd-71b375c1d4ef',
      createdAt: '2026-10-23T10:00:00.000Z',
      email: 'member@example.com',
      membershipType: 'individual' as const,
      membershipNumber: '203',
      membershipHolderName: 'Test Member',
      memberAge: 40,
      spouseName: '',
      spouseAge: null,
      children: [],
      otherFamilyMembers: '',
      address: '',
      postcode: 'SO1 1AA',
      phone: '07123456789',
      spousePhone: '',
      additionalPhones: '',
      consent: true,
    };
    dashboard['records'] = [record];
    const fetchSpy = spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(new Response(null, { status: 204 })),
    );

    dashboard['requestDelete'](record);
    expect(fetchSpy).not.toHaveBeenCalled();
    await dashboard['confirmDialogAction']();

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/admin/membership-renewals/${record.id}`,
      jasmine.objectContaining({ method: 'DELETE' }),
    );
    expect(dashboard['records']).toEqual([]);
  });
});
