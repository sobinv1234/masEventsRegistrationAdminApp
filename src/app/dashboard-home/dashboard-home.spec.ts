import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardHome } from './dashboard-home';

describe('DashboardHome', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardHome],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();
  });

  it('shows registration entries as progress against the directory', () => {
    const fixture = TestBed.createComponent(DashboardHome);
    const dashboard = fixture.componentInstance;
    dashboard['loggedIn'] = true;
    dashboard['members'] = [
      { membershipNumber: '20', names: ['Member One'], phones: [], email: '' },
      { membershipNumber: '21', names: ['Member Two'], phones: [], email: '' },
      { membershipNumber: '22', names: ['Member Three'], phones: [], email: '' },
      { membershipNumber: '23', names: ['Member Four'], phones: [], email: '' },
    ];
    dashboard['registrations'] = [
      { membershipNumber: '20' },
      { membershipNumber: '20' },
      { membershipNumber: '21' },
      {},
      {},
    ];
    fixture.detectChanges();

    expect(dashboard['registeredMembershipCount']).toBe(2);
    expect(dashboard['registrationProgress']).toBe(100);
    expect(fixture.nativeElement.querySelector('.progress-percent').textContent.trim())
      .toBe('100%');
    expect(fixture.nativeElement.querySelector('.progress-labels').textContent)
      .toContain('5 registrations');
  });

  it('searches the member directory by name, membership number, phone, and email', () => {
    const fixture = TestBed.createComponent(DashboardHome);
    const dashboard = fixture.componentInstance;
    dashboard['members'] = [
      {
        membershipNumber: '20',
        names: ['Member One', 'Family Member'],
        phones: ['07123456789'],
        email: 'member@example.com',
        address: '1 Test Street',
      },
      { membershipNumber: '21', names: ['Other Member'], phones: [], email: '' },
    ];
    dashboard['searchTerm'] = '071234';
    expect(dashboard['filteredMembers'].map((member) => member.membershipNumber)).toEqual([
      '20',
    ]);

    dashboard['searchTerm'] = 'family member';
    expect(dashboard['filteredMembers'].map((member) => member.membershipNumber)).toEqual([
      '20',
    ]);

    dashboard['searchTerm'] = 'member@example.com';
    expect(dashboard['filteredMembers'].map((member) => member.membershipNumber)).toEqual([
      '20',
    ]);

    dashboard['searchTerm'] = 'test street';
    expect(dashboard['filteredMembers'].map((member) => member.membershipNumber)).toEqual([
      '20',
    ]);
  });

  it('builds an Excel-compatible member CSV with addresses and formula values escaped', () => {
    const dashboard = TestBed.createComponent(DashboardHome).componentInstance;
    dashboard['members'] = [
      {
        membershipNumber: '20',
        names: ['=Formula'],
        phones: ['07123456789'],
        email: 'member@example.com',
        address: '1 Test Street',
      },
    ];

    const csv = dashboard['buildCsv']();

    expect(csv).toContain('"Membership number","Member name(s)","Phone number(s)","Email address","Address"');
    expect(csv).toContain('"20","\'=Formula","07123456789","member@example.com","1 Test Street"');
  });

  it('uses the latest submitted contact address for its membership', async () => {
    const dashboard = TestBed.createComponent(DashboardHome).componentInstance;
    dashboard['members'] = [
      { membershipNumber: '20', names: ['Member One'], phones: [], email: '' },
    ];
    spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(
        new Response(JSON.stringify([
          { membershipNumber: '20', address: 'Latest address' },
          { membershipNumber: '20', address: 'Earlier address' },
        ])),
      ),
    );

    await dashboard['loadMemberAddresses']({ Authorization: 'Basic test' });

    expect(dashboard['members'][0].address).toBe('Latest address');
  });

  it('includes the full event calendar and registration navigation', () => {
    const fixture = TestBed.createComponent(DashboardHome);
    const dashboard = fixture.componentInstance;
    dashboard['loggedIn'] = true;
    fixture.detectChanges();

    expect(dashboard['events'].length).toBe(12);
    expect(fixture.nativeElement.querySelector('a[routerlink="/admin/board-games"]'))
      .not.toBeNull();
    expect(fixture.nativeElement.querySelector('.download-button')).not.toBeNull();
  });
});
