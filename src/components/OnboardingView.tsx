import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import { Building2, LogOut, MailCheck } from 'lucide-react';
import type { PendingInvite } from '../types/farm.ts';

interface OnboardingViewProps {
  user: User;
  pendingInvite: PendingInvite | null;
  onCreateFarm: (params: {
    farmName: string;
    location: string;
    contactPhone: string;
    contactEmail: string;
    timezone: string;
  }) => Promise<void>;
  onAcceptInvite: (invite: PendingInvite) => Promise<void>;
  onSignOut: () => Promise<void>;
}

export const OnboardingView: React.FC<OnboardingViewProps> = ({
  user,
  pendingInvite,
  onCreateFarm,
  onAcceptInvite,
  onSignOut,
}) => {
  const [farmName, setFarmName] = useState('Babagiwa Poultry Farm');
  const [location, setLocation] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState(user.email || '');
  const [timezone, setTimezone] = useState('Africa/Lagos');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateFarmSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onCreateFarm({ farmName, location, contactPhone, contactEmail, timezone });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAccept = async () => {
    if (!pendingInvite) return;
    setError(null);
    setSubmitting(true);
    try {
      await onAcceptInvite(pendingInvite);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto max-w-xl">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <p className="font-display text-lg font-bold text-slate-900">Babagiwa Farms</p>
            <p className="text-xs text-slate-500">
              Signed in as {user.displayName || user.email} ({user.email})
            </p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out</span>
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {error}
          </div>
        )}

        {pendingInvite ? (
          <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800">
                <MailCheck className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Farm Staff Invitation Found</h1>
                <p className="text-xs text-slate-500">
                  One-farm-per-account binding applies upon acceptance.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Farm Name</span>
                <span className="font-semibold text-slate-900">{pendingInvite.farmName}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Assigned Job Title</span>
                <span className="font-medium text-slate-900">{pendingInvite.jobTitle}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Invited Email</span>
                <span className="font-mono text-xs text-slate-700">{pendingInvite.emailLower}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleAccept}
              disabled={submitting}
              className="mt-6 w-full rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-60"
            >
              {submitting ? 'Joining Farm Workspace...' : `Accept & Join ${pendingInvite.farmName}`}
            </button>
          </div>
        ) : (
          <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Initialize Your Farm Account</h1>
                <p className="text-xs text-slate-500">
                  Sets up your poultry operations tenant and binds your account as Farm Owner.
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateFarmSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="farm-name" className="block text-sm font-medium text-slate-700">
                  Farm Name <span className="text-red-600">*</span>
                </label>
                <input
                  id="farm-name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  value={farmName}
                  onChange={(e) => setFarmName(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                />
              </div>

              <div>
                <label htmlFor="farm-location" className="block text-sm font-medium text-slate-700">
                  Farm Location / Address
                </label>
                <input
                  id="farm-location"
                  type="text"
                  maxLength={200}
                  placeholder="e.g. Abeokuta, Ogun State"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="farm-phone" className="block text-sm font-medium text-slate-700">
                    Contact Phone
                  </label>
                  <input
                    id="farm-phone"
                    type="tel"
                    maxLength={60}
                    placeholder="e.g. +234 800 000 0000"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                  />
                </div>
                <div>
                  <label htmlFor="farm-email" className="block text-sm font-medium text-slate-700">
                    Contact Email
                  </label>
                  <input
                    id="farm-email"
                    type="email"
                    maxLength={150}
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="farm-currency" className="block text-sm font-medium text-slate-700">
                    Currency
                  </label>
                  <input
                    id="farm-currency"
                    type="text"
                    value="NGN (₦)"
                    disabled
                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600"
                  />
                </div>
                <div>
                  <label htmlFor="farm-timezone" className="block text-sm font-medium text-slate-700">
                    Farm Timezone
                  </label>
                  <select
                    id="farm-timezone"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                  >
                    <option value="Africa/Lagos">Africa/Lagos (WAT, UTC+1)</option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="mt-2 w-full rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-60"
              >
                {submitting ? 'Creating Farm Workspace...' : 'Create Farm & Continue'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
