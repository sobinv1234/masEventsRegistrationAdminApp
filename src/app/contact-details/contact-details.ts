import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

type ContactMatch = {
  membershipNumber: string;
  names: string[];
  membershipType: 'individual' | 'family';
};
type ContactChild = { name: string; age: number | null };

@Component({
  selector: 'app-contact-details',
  imports: [FormsModule, RouterLink],
  templateUrl: './contact-details.html',
  styleUrl: './contact-details.scss',
})
export class ContactDetailsForm {
  private readonly changeDetector = inject(ChangeDetectorRef);
  protected phone = '';
  protected membershipNumber = '';
  protected name = '';
  protected membershipType: 'individual' | 'family' = 'individual';
  protected spouseName = '';
  protected spouseAge: number | null = null;
  protected spousePhone = '';
  protected children: ContactChild[] = Array.from({ length: 4 }, () => ({
    name: '',
    age: null,
  }));
  protected email = '';
  protected address = '';
  protected consent = false;
  protected matches: ContactMatch[] = [];
  protected selectedMatch = -1;
  protected lookupMessage = '';
  protected errorMessage = '';
  protected successMessage = '';
  protected lookingUp = false;
  protected phoneMatchVerified = false;
  protected submitting = false;
  protected submitted = false;
  private phoneLookupRequest = 0;

  protected onPhoneChanged(): void {
    this.phoneLookupRequest += 1;
    this.lookingUp = false;
    this.membershipNumber = '';
    this.name = '';
    this.membershipType = 'individual';
    this.spouseName = '';
    this.spouseAge = null;
    this.spousePhone = '';
    this.children = Array.from({ length: 4 }, () => ({ name: '', age: null }));
    this.email = '';
    this.matches = [];
    this.selectedMatch = -1;
    this.phoneMatchVerified = false;
    this.lookupMessage = '';
    this.errorMessage = '';
  }

  protected async lookupPhone(): Promise<void> {
    const phone = this.phone.trim();
    if (!phone || this.lookingUp) {
      return;
    }
    const requestId = ++this.phoneLookupRequest;
    this.lookingUp = true;
    this.phoneMatchVerified = false;
    this.lookupMessage = '';
    this.errorMessage = '';
    try {
      const response = await fetch('/api/membership-phone-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
        cache: 'no-store',
      });
      if (requestId !== this.phoneLookupRequest || phone !== this.phone.trim()) {
        return;
      }
      if (response.status === 404) {
        this.matches = [];
        this.membershipNumber = '';
        this.lookupMessage =
          'No matching member was found. Check that your phone number is listed in the member directory.';
        return;
      }
      if (!response.ok) {
        throw new Error(await this.getApiError(response, 'Could not look up this phone number.'));
      }
      const result: {
        matches?: unknown;
      } = await response.json();
      if (requestId !== this.phoneLookupRequest || phone !== this.phone.trim()) {
        return;
      }
      if (
        !Array.isArray(result.matches) ||
        !result.matches.every(
          (match) =>
            typeof match === 'object' &&
            match !== null &&
            typeof match.membershipNumber === 'string' &&
            Array.isArray(match.names) &&
            match.names.length > 0 &&
            match.names.every((name: unknown) => typeof name === 'string') &&
            (match.membershipType === 'individual' ||
              match.membershipType === 'family'),
        )
      ) {
        throw new Error('The mobile lookup returned an invalid response.');
      }
      this.matches = result.matches;
      if (this.matches.length === 1) {
        this.selectMatch(0);
        this.lookupMessage = 'Member details found. Please check and complete your details.';
      } else {
        this.lookupMessage = 'More than one member matches. Please select your name.';
      }
    } catch (error) {
      if (requestId !== this.phoneLookupRequest) {
        return;
      }
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the member lookup service. Please try again before submitting.'
          : error instanceof Error
            ? error.message
            : 'Could not look up this phone number.';
    } finally {
      if (requestId === this.phoneLookupRequest) {
        this.lookingUp = false;
        this.changeDetector.markForCheck();
      }
    }
  }

  protected selectMatch(index: number): void {
    const match = this.matches[index];
    if (!match) {
      this.membershipNumber = '';
      this.phoneMatchVerified = false;
      return;
    }
    this.selectedMatch = index;
    this.membershipNumber = match.membershipNumber;
    this.name = match.names.join(', ');
    this.membershipType = match.membershipType;
    this.phoneMatchVerified = true;
    this.errorMessage = '';
    this.lookupMessage = 'Member details found. Please check and complete your details.';
  }

  protected async submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (this.submitting || this.submitted) {
      return;
    }
    if (!this.phoneMatchVerified || this.selectedMatch < 0) {
      this.errorMessage = 'Find and select a matching member using a phone number in the member directory.';
      this.changeDetector.markForCheck();
      return;
    }
    this.errorMessage = '';
    this.successMessage = '';
    this.submitting = true;
    try {
      const response = await fetch('/api/contact-details-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: this.phone,
          membershipNumber: this.membershipNumber,
          name: this.name,
          membershipType: this.membershipType,
          spouseName: this.spouseName,
          spouseAge: this.spouseAge,
          spousePhone: this.spousePhone,
          children: this.children,
          email: this.email,
          address: this.address,
          consent: this.consent,
        }),
      });
      const result: { message?: string } = await response.json();
      if (!response.ok) {
        throw new Error(result.message || 'Could not submit your contact details.');
      }
      this.successMessage =
        result.message || 'Your contact details have been submitted.';
      this.submitted = true;
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the contact-details service. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Could not submit your contact details.';
    } finally {
      this.submitting = false;
      this.changeDetector.markForCheck();
    }
  }

  private async getApiError(response: Response, fallback: string): Promise<string> {
    try {
      const result: { message?: string } = await response.json();
      return result.message || fallback;
    } catch {
      return fallback;
    }
  }
}
