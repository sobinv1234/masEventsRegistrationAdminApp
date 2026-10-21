import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminDashboard } from './admin-dashboard';

describe('AdminDashboard filters', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminDashboard],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  it('combines text, age, game, and email-status filters', () => {
    const fixture = TestBed.createComponent(AdminDashboard);
    const dashboard = fixture.componentInstance;
    dashboard['records'] = [
      {
        id: 'minor',
        createdAt: '2026-10-01T10:00:00.000Z',
        name: 'Alex Player',
        age: 14,
        phone: '07123456789',
        email: 'alex@example.com',
        guardian: 'Sam Guardian',
        games: [{ game: 'Chess', category: '14–17' }],
        emailSent: true,
      },
      {
        id: 'adult',
        createdAt: '2026-10-02T10:00:00.000Z',
        name: 'Jordan Player',
        age: 21,
        phone: '07987654321',
        email: '',
        guardian: '',
        games: [{ game: 'Cards', category: '18+' }],
        emailSent: false,
      },
    ];

    dashboard['ageFilter'] = '14-17';
    dashboard['gameFilter'] = 'Chess';
    dashboard['emailFilter'] = 'sent';
    expect(dashboard['filteredRecords'].map((record) => record.id)).toEqual([
      'minor',
    ]);

    dashboard['searchTerm'] = 'sam guardian';
    expect(dashboard['filteredRecords'].map((record) => record.id)).toEqual([
      'minor',
    ]);

    dashboard['searchTerm'] = 'jordan';
    expect(dashboard['filteredRecords']).toEqual([]);
  });

  it('clears all filters', () => {
    const fixture = TestBed.createComponent(AdminDashboard);
    const dashboard = fixture.componentInstance;
    dashboard['searchTerm'] = 'Chess';
    dashboard['ageFilter'] = '14-17';
    dashboard['gameFilter'] = 'Chess';
    dashboard['emailFilter'] = 'pending';

    dashboard['clearFilters']();

    expect(dashboard['hasActiveFilters']).toBeFalse();
    expect(dashboard['searchTerm']).toBe('');
    expect(dashboard['ageFilter']).toBe('all');
    expect(dashboard['gameFilter']).toBe('all');
    expect(dashboard['emailFilter']).toBe('all');
  });

  it('reports a missing dashboard API route instead of a configuration error', async () => {
    const fixture = TestBed.createComponent(AdminDashboard);
    const dashboard = fixture.componentInstance;
    dashboard['username'] = 'committee';
    dashboard['password'] = 'test-password';
    spyOn(globalThis, 'fetch').and.resolveTo(
      new Response('Not Found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    await dashboard['login'](new Event('submit') as SubmitEvent);

    expect(dashboard['errorMessage']).toBe(
      'Dashboard API route was not found (HTTP 404). Check the Vercel function deployment.',
    );
  });

  it('schedules clearing all existing registrations from the generic confirmation dialog', async () => {
    const fixture = TestBed.createComponent(AdminDashboard);
    const dashboard = fixture.componentInstance;
    dashboard['authorization'] = 'Basic test';
    const schedule = {
      requestedAt: '2026-10-21T12:00:00.000Z',
      scheduledFor: '2026-10-31T12:00:00.000Z',
    };
    const fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo(
      new Response(JSON.stringify({ schedule }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    dashboard['requestClearAll']();
    expect(dashboard['confirmationDialog']?.title).toBe('Schedule clear all data?');
    expect(dashboard['confirmationDialog']?.message).toContain(
      'Registrations submitted after scheduling will be kept.',
    );

    await dashboard['confirmDialogAction']();

    expect(fetchSpy).toHaveBeenCalledWith('/api/admin/registrations/clear-schedule', {
      method: 'POST',
      headers: { Authorization: 'Basic test' },
    });
    expect(dashboard['clearSchedule']).toEqual(schedule);
    expect(dashboard['confirmationDialog']).toBeNull();
  });

  it('cancels a previously scheduled data clear', async () => {
    const fixture = TestBed.createComponent(AdminDashboard);
    const dashboard = fixture.componentInstance;
    dashboard['authorization'] = 'Basic test';
    dashboard['clearSchedule'] = {
      requestedAt: '2026-10-21T12:00:00.000Z',
      scheduledFor: '2026-10-31T12:00:00.000Z',
    };
    const fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo(
      new Response(JSON.stringify({ message: 'Scheduled clear cancelled.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await dashboard['cancelScheduledClear']();

    expect(fetchSpy).toHaveBeenCalledWith('/api/admin/registrations/clear-schedule', {
      method: 'DELETE',
      headers: { Authorization: 'Basic test' },
    });
    expect(dashboard['clearSchedule']).toBeNull();
  });

  it('paginates filtered registrations and resets to the first page when filters change', () => {
    const fixture = TestBed.createComponent(AdminDashboard);
    const dashboard = fixture.componentInstance;
    dashboard['records'] = Array.from({ length: 23 }, (_, index) => ({
      id: `record-${index + 1}`,
      createdAt: '2026-10-01T10:00:00.000Z',
      name: `Participant ${index + 1}`,
      age: index < 12 ? 12 : 18,
      phone: `070000000${index}`,
      email: '',
      guardian: '',
      games: [
        {
          game: index < 12 ? 'Chess' : 'Cards',
          category: index < 12 ? '8–13' : '18+',
        },
      ],
      emailSent: true,
    }));

    expect(dashboard['paginatedRecords'].length).toBe(10);
    expect(dashboard['firstVisibleRecord']).toBe(1);
    expect(dashboard['lastVisibleRecord']).toBe(10);

    dashboard['goToPage'](3);
    expect(dashboard['paginatedRecords'].length).toBe(3);
    expect(dashboard['firstVisibleRecord']).toBe(21);

    dashboard['ageFilter'] = '8-13';
    dashboard['onFiltersChanged']();
    expect(dashboard['currentPage']).toBe(1);
    expect(dashboard['filteredRecords'].length).toBe(12);
    expect(dashboard['paginatedRecords'].length).toBe(10);
    expect(dashboard['totalPages']).toBe(2);

    dashboard['goToPage'](99);
    expect(dashboard['currentPage']).toBe(2);
  });

  it('deletes a registration only after confirmation and removes it from the dashboard', async () => {
    const fixture = TestBed.createComponent(AdminDashboard);
    const dashboard = fixture.componentInstance;
    const record = {
      id: 'registration-to-delete',
      createdAt: '2026-10-01T10:00:00.000Z',
      name: 'Participant',
      age: 18,
      phone: '07000000000',
      email: '',
      guardian: '',
      games: [{ game: 'Cards', category: '18+' }],
      emailSent: true,
    };
    dashboard['records'] = [record];
    dashboard['authorization'] = 'Basic test';
    const fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo(
      new Response(null, { status: 204 }),
    );

    await dashboard['deleteRegistration'](record);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dashboard['records']).toEqual([record]);

    dashboard['requestDelete'](record);
    await dashboard['deleteRegistration'](record);

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/admin/registrations/registration-to-delete',
      {
        method: 'DELETE',
        headers: { Authorization: 'Basic test' },
      },
    );
    expect(dashboard['records']).toEqual([]);
    expect(dashboard['pendingDeleteId']).toBeNull();
    expect(dashboard['deletingId']).toBeNull();
  });

  it('does not remove a registration when delete fails', async () => {
    const fixture = TestBed.createComponent(AdminDashboard);
    const dashboard = fixture.componentInstance;
    const record = {
      id: 'registration-delete-failure',
      createdAt: '2026-10-01T10:00:00.000Z',
      name: 'Participant',
      age: 18,
      phone: '07000000000',
      email: '',
      guardian: '',
      games: [{ game: 'Chess', category: '18+' }],
      emailSent: true,
    };
    dashboard['records'] = [record];
    dashboard['authorization'] = 'Basic test';
    spyOn(globalThis, 'fetch').and.resolveTo(
      new Response(JSON.stringify({ message: 'Registration not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    dashboard['requestDelete'](record);

    await dashboard['deleteRegistration'](record);

    expect(dashboard['records']).toEqual([record]);
    expect(dashboard['errorMessage']).toBe('Registration not found.');
  });
});
