import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

type Game = 'Carroms' | 'Chess' | 'PlayStation' | 'Cards';
type MembershipPhoneMatch = { membershipNumber: string; names: string[] };
const enterNewNameOption = '__enter_new_name__';

@Component({
  selector: 'app-registration',
  imports: [FormsModule, RouterLink],
  templateUrl: './registration.html',
  styleUrl: './registration.scss',
})
export class Registration {
  private readonly changeDetector = inject(ChangeDetectorRef);
  protected readonly games: Game[] = ['Carroms', 'Chess', 'PlayStation'];
  protected name = '';
  protected membershipNumber = '';
  protected membershipNames: string[] = [];
  protected customNameSelected = false;
  protected membershipNumberValid = false;
  protected membershipLookupLoading = false;
  protected membershipLookupMessage = '';
  protected membershipStatus: 'renewal' | 'register' | null = null;
  protected phoneLookupMatches: MembershipPhoneMatch[] = [];
  protected phoneLookupLoading = false;
  protected phoneLookupMessage = '';
  protected age: number | null = null;
  protected phone = '';
  protected email = '';
  protected guardian = '';
  protected consent = false;
  protected paymentConfirmed = false;
  protected selectedGames: Game[] = [];
  protected submitting = false;
  protected registrationComplete = false;
  protected errorMessage = '';
  protected successMessage = '';
  private lastLookedUpMembershipNumber = '';
  private lastAutofilledName = '';
  private membershipLookupRequest = 0;
  private lastPhoneLookup = '';
  private lastPhoneMembershipNumber = '';
  private phoneLookupRequest = 0;

  protected get minor(): boolean {
    return this.age !== null && this.age < 18;
  }

  protected get ageCategory(): string {
    if (this.age === null || this.age < 8) {
      return '';
    }
    if (this.age <= 13) {
      return '8–13';
    }
    if (this.age <= 17) {
      return '14–17';
    }
    return '18+';
  }

  protected onAgeChange(): void {
    if (this.age === null || this.age < 18) {
      this.selectedGames = this.selectedGames.filter((game) => game !== 'Cards');
    }
    if (!this.minor) {
      this.guardian = '';
    }
  }

  protected onMembershipNumberChange(): void {
    this.membershipNumberValid = false;
    this.lastLookedUpMembershipNumber = '';
    this.membershipNames = [];
    this.customNameSelected = false;
    this.membershipLookupMessage = '';
    this.membershipStatus = null;
    this.membershipLookupLoading = false;
    this.membershipLookupRequest += 1;
    if (this.lastAutofilledName && this.name === this.lastAutofilledName) {
      this.name = '';
    }
    this.lastAutofilledName = '';
  }

  protected onPhoneChange(): void {
    this.phoneLookupRequest += 1;
    this.phoneLookupMatches = [];
    this.phoneLookupLoading = false;
    this.phoneLookupMessage = '';
    this.lastPhoneLookup = '';

    if (
      this.lastPhoneMembershipNumber &&
      this.membershipNumber === this.lastPhoneMembershipNumber
    ) {
      this.membershipNumber = '';
      this.onMembershipNumberChange();
    }
    this.lastPhoneMembershipNumber = '';
  }

  protected async lookupMembershipByPhone(): Promise<void> {
    const normalizedPhone = this.normalizePhoneNumber(this.phone);
    if (
      normalizedPhone.length < 7 ||
      normalizedPhone.length > 15 ||
      normalizedPhone === this.lastPhoneLookup
    ) {
      return;
    }

    const requestId = ++this.phoneLookupRequest;
    this.phoneLookupLoading = true;
    this.phoneLookupMessage = '';
    try {
      const response = await fetch('/api/membership-phone-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: this.phone.trim() }),
      });
      if (
        requestId !== this.phoneLookupRequest ||
        normalizedPhone !== this.normalizePhoneNumber(this.phone)
      ) {
        return;
      }

      if (response.status === 404) {
        this.lastPhoneLookup = normalizedPhone;
        this.phoneLookupMessage =
          'No matching member found. Enter the membership number manually.';
        return;
      }
      if (!response.ok) {
        throw new Error(`Mobile number lookup failed (HTTP ${response.status}).`);
      }

      const result: { matches?: unknown } = await response.json();
      if (
        !Array.isArray(result.matches) ||
        result.matches.length === 0 ||
        !result.matches.every(
          (match) =>
            typeof match === 'object' &&
            match !== null &&
            typeof match.membershipNumber === 'string' &&
            Array.isArray(match.names) &&
            match.names.length > 0 &&
            match.names.every(
              (name: unknown) => typeof name === 'string' && name.length > 0,
            ),
        )
      ) {
        throw new Error('The mobile lookup returned an invalid response.');
      }

      this.phoneLookupMatches = result.matches;
      this.lastPhoneLookup = normalizedPhone;
      if (this.phoneLookupMatches.length === 1) {
        await this.selectPhoneLookupMatch(this.phoneLookupMatches[0]);
      } else {
        this.phoneLookupMessage =
          'More than one member uses this mobile number. Choose a member.';
      }
    } catch (error) {
      if (
        requestId !== this.phoneLookupRequest ||
        normalizedPhone !== this.normalizePhoneNumber(this.phone)
      ) {
        return;
      }
      this.phoneLookupMessage =
        error instanceof TypeError
          ? 'Could not reach the mobile lookup service. You can enter the membership number manually.'
          : error instanceof Error
            ? error.message
            : 'Could not look up this mobile number.';
    } finally {
      if (requestId === this.phoneLookupRequest) {
        this.phoneLookupLoading = false;
        this.changeDetector.markForCheck();
      }
    }
  }

  protected async onPhoneMemberSelected(membershipNumber: string): Promise<void> {
    const match = this.phoneLookupMatches.find(
      (candidate) => candidate.membershipNumber === membershipNumber,
    );
    if (match) {
      await this.selectPhoneLookupMatch(match);
    }
  }

  private async selectPhoneLookupMatch(match: MembershipPhoneMatch): Promise<void> {
    this.membershipNumber = match.membershipNumber;
    this.lastPhoneMembershipNumber = match.membershipNumber;
    this.phoneLookupMatches = [];
    this.onMembershipNumberChange();
    await this.lookupMembershipNumber();
    this.phoneLookupMessage =
      this.membershipStatus === 'renewal'
        ? 'Your membership needs renewal before board-game registration.'
        : this.membershipStatus === 'register'
          ? 'Please register your MAS membership before board-game registration.'
          : 'Member number and name found from mobile number.';
  }

  private normalizePhoneNumber(value: string): string {
    let digits = value.replace(/\D/g, '');
    if (digits.startsWith('0044')) {
      digits = digits.slice(4);
      return `0${digits}`;
    }
    if (digits.startsWith('44')) {
      digits = digits.slice(2);
      return `0${digits}`;
    }
    return digits.startsWith('0') ? digits : `0${digits}`;
  }

  protected async lookupMembershipNumber(): Promise<void> {
    const membershipNumber = this.membershipNumber.trim();
    if (!membershipNumber || membershipNumber === this.lastLookedUpMembershipNumber) {
      return;
    }

    const requestId = ++this.membershipLookupRequest;
    this.membershipLookupLoading = true;
    this.membershipLookupMessage = '';
    this.membershipStatus = null;
    try {
      const response = await fetch('/api/membership-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membershipNumber }),
      });
      if (
        requestId !== this.membershipLookupRequest ||
        membershipNumber !== this.membershipNumber.trim()
      ) {
        return;
      }

      if (response.status === 404) {
        const result: { renewed?: unknown } = await response.json();
        if (typeof result.renewed !== 'boolean') {
          throw new Error('The membership lookup returned an invalid response.');
        }
        if (this.lastAutofilledName && this.name === this.lastAutofilledName) {
          this.name = '';
        }
        this.lastAutofilledName = '';
        this.lastLookedUpMembershipNumber = membershipNumber;
        this.membershipNumberValid = false;
        if (result.renewed) {
          this.membershipNumberValid = true;
          this.membershipNames = [];
          this.customNameSelected = false;
          this.membershipLookupMessage =
            'Renewed member found. Enter the participant name.';
          return;
        }
        this.membershipStatus = 'register';
        this.membershipLookupMessage =
          'Please register your MAS membership before registering for board games.';
        return;
      }
      if (!response.ok) {
        throw new Error(`Membership lookup failed (HTTP ${response.status}).`);
      }

      const result: { names?: unknown; renewed?: unknown } = await response.json();
      if (
        typeof result.renewed !== 'boolean' ||
        !Array.isArray(result.names) ||
        result.names.length === 0 ||
        !result.names.every((name) => typeof name === 'string' && name.length > 0)
      ) {
        throw new Error('The membership lookup returned an invalid response.');
      }
      if (!result.renewed) {
        this.membershipNumberValid = false;
        this.membershipNames = [];
        if (this.lastAutofilledName && this.name === this.lastAutofilledName) {
          this.name = '';
        }
        this.lastAutofilledName = '';
        this.customNameSelected = false;
        this.lastLookedUpMembershipNumber = membershipNumber;
        this.membershipStatus = 'renewal';
        this.membershipLookupMessage =
          'Your MAS membership must be renewed before registering for board games.';
        return;
      }
      this.membershipNames = result.names;
      this.membershipNumberValid = true;
      this.lastLookedUpMembershipNumber = membershipNumber;
      this.customNameSelected = false;
      if (this.membershipNames.length === 1) {
        this.name = this.membershipNames[0];
        this.lastAutofilledName = this.name;
        this.membershipLookupMessage =
          'Member found. You can edit the participant name if needed.';
      } else {
        this.name = '';
        this.lastAutofilledName = '';
        this.membershipLookupMessage = 'More than one member found. Choose a name.';
      }
    } catch (error) {
      if (
        requestId !== this.membershipLookupRequest ||
        membershipNumber !== this.membershipNumber.trim()
      ) {
        return;
      }
      this.membershipLookupMessage =
        error instanceof TypeError
          ? 'Could not reach the membership lookup service. You can enter the participant name manually.'
          : error instanceof Error
            ? error.message
            : 'Could not look up this membership number.';
    } finally {
      if (requestId === this.membershipLookupRequest) {
        this.membershipLookupLoading = false;
        this.changeDetector.markForCheck();
      }
    }
  }

  protected onMemberNameSelected(): void {
    if (this.name === enterNewNameOption) {
      this.name = '';
      this.customNameSelected = true;
      this.lastAutofilledName = '';
      this.membershipLookupMessage = 'Enter the participant name.';
      return;
    }

    this.customNameSelected = false;
    this.lastAutofilledName = this.name;
    if (this.name) {
      this.membershipLookupMessage = 'Member name selected.';
    }
  }

  protected dismissMembershipStatus(): void {
    this.membershipStatus = null;
  }

  protected toggleGame(game: Game, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked && !this.selectedGames.includes(game)) {
      this.selectedGames = [...this.selectedGames, game];
    } else if (!checked) {
      this.selectedGames = this.selectedGames.filter((selected) => selected !== game);
    }
  }

  protected async submit(): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';
    if (!this.membershipNumber.trim()) {
      this.errorMessage = 'A membership number is required.';
      return;
    }
    if (
      this.membershipNumber.trim() &&
      this.membershipNumber.trim() !== this.lastLookedUpMembershipNumber
    ) {
      await this.lookupMembershipNumber();
    }
    if (!this.membershipNumberValid) {
      this.errorMessage = 'Enter a valid membership number from the member list.';
      return;
    }
    if (!this.age || this.age < 8 || !this.selectedGames.length) {
      this.errorMessage = 'Enter an eligible age and select at least one game.';
      return;
    }
    if (this.age < 18 && !this.guardian.trim()) {
      this.errorMessage = 'A parent or guardian name is required for participants under 18.';
      return;
    }
    if (!this.membershipNumber.trim()) {
      this.errorMessage = 'A membership number is required.';
      return;
    }

    this.submitting = true;
    try {
      const response = await fetch('/api/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: this.name.trim(),
          membershipNumber: this.membershipNumber.trim(),
          age: this.age,
          phone: this.phone.trim(),
          email: this.email.trim(),
          guardian: this.minor ? this.guardian.trim() : '',
          games: this.selectedGames,
          consent: this.consent,
          paymentConfirmed: this.paymentConfirmed,
        }),
      });
      let result: { message?: string; registrationSaved?: boolean };
      try {
        result = await response.json();
      } catch {
        throw new Error(
          `The registration service returned an invalid response (HTTP ${response.status}). Please try again later.`,
        );
      }
      if (!response.ok) {
        if (result.registrationSaved) {
          this.successMessage = result.message ?? 'Your registration was saved.';
          this.registrationComplete = true;
          this.clearForm();
          this.changeDetector.markForCheck();
          return;
        }
        throw new Error(result.message ?? 'Registration could not be submitted.');
      }
      this.successMessage =
        result.message ?? 'Thank you! Your registration has been submitted to MAS.';
      this.registrationComplete = true;
      this.clearForm();
      this.changeDetector.markForCheck();
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'We could not reach the registration service. Please try again later.'
          : error instanceof Error
            ? error.message
            : 'Registration could not be submitted.';
      this.changeDetector.markForCheck();
    } finally {
      this.submitting = false;
      this.changeDetector.markForCheck();
    }
  }

  private clearForm(): void {
    this.name = '';
    this.membershipNumber = '';
    this.membershipNames = [];
    this.customNameSelected = false;
    this.membershipNumberValid = false;
    this.membershipLookupLoading = false;
    this.membershipLookupMessage = '';
    this.membershipStatus = null;
    this.phoneLookupMatches = [];
    this.phoneLookupLoading = false;
    this.phoneLookupMessage = '';
    this.lastLookedUpMembershipNumber = '';
    this.lastAutofilledName = '';
    this.lastPhoneLookup = '';
    this.lastPhoneMembershipNumber = '';
    this.membershipLookupRequest += 1;
    this.phoneLookupRequest += 1;
    this.age = null;
    this.phone = '';
    this.email = '';
    this.guardian = '';
    this.consent = false;
    this.paymentConfirmed = false;
    this.selectedGames = [];
  }
}
