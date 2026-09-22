import { useState } from 'react';
import { Assumptions } from '../components/Assumptions';
import { Icon } from '../components/Icon';
import { DailyLogs } from '../features/daily-logs/DailyLogs';
import { Directions } from '../features/route-plan/Directions';
import { Itinerary } from '../features/route-plan/Itinerary';
import { RouteMap } from '../features/route-plan/RouteMap';
import { TripErrorBanner } from '../features/route-plan/TripErrorBanner';
import { TripSummary } from '../features/route-plan/TripSummary';
import { TripForm } from '../features/trip-form/TripForm';
import { usePlanner } from './usePlanner';

export default function App() {
  const planner = usePlanner();
  const [selectedStop, setSelectedStop] = useState<string | null>(null);
  const edit = () => {
    setSelectedStop(null);
    planner.edit();
  };

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to trip planner
      </a>
      <header className="site-header">
        <a className="brand" href="#" aria-label="Spotter home">
          <span className="brand-mark">
            <Icon name="route" size={26} />
          </span>
          <span>
            spotter<span className="brand-period">.</span>
          </span>
        </a>
        <span className="brand-divider" />
        <span className="header-description">A little clarity for the long haul.</span>
        <nav aria-label="Main navigation">
          <a href="#main-content" aria-current="page">
            Trip planner
          </a>
          <a href="#daily-logs">Daily logs</a>
        </nav>
        <span className="assessment-tag">
          <Icon name="shield" size={15} />
          Assessment workspace
        </span>
      </header>
      <main id="main-content" className="app-shell">
        <div className="page-intro">
          <div>
            <div className="section-eyebrow">LESS GUESSWORK. MORE OPEN ROAD.</div>
            <h1>
              Your next trip, <span>all mapped out.</span>
            </h1>
            <p>A practical route. The right breaks. A logbook that adds up.</p>
          </div>
          <div className="planning-standard">
            <Icon name="truck" size={23} />
            <div>
              <strong>Property-carrying · US</strong>
              <span>70-hour / 8-day planning model</span>
            </div>
          </div>
        </div>
        {planner.bootLoading && (
          <p className="service-status" role="status">
            <span className="spinner small" />
            Connecting to the planning service…
          </p>
        )}
        {planner.bootstrapError && (
          <div className="banner error-banner" role="alert">
            <Icon name="info" />
            <div>
              <strong>We couldn’t load the planning workspace.</strong>
              <p>{planner.bootstrapError}</p>
            </div>
            <button className="button secondary" type="button" onClick={planner.reload}>
              Retry connection
            </button>
          </div>
        )}
        {planner.bootstrap && !planner.bootstrap.provider_ready && (
          <div className="banner config-banner" role="status">
            <Icon name="info" />
            <div>
              <strong>A quick setup before your first trip.</strong>
              <p>
                The planning provider is not configured. Configure the backend’s TomTom server
                credential locally, add a separate restricted public map key, and restart the
                backend. Never put the server credential in frontend files.
              </p>
            </div>
            <button type="button" className="button secondary" onClick={planner.reload}>
              Check setup again
            </button>
          </div>
        )}
        <div className="planner-layout">
          <TripForm
            bootstrap={planner.bootstrap}
            busy={planner.busy}
            errors={planner.error?.fields ?? {}}
            onEdit={edit}
            onSubmit={(input) => {
              setSelectedStop(null);
              void planner.generate(input);
            }}
            onCancel={planner.cancel}
          />
          <div className="route-workspace">
            <div className="workspace-heading">
              <h2 ref={planner.resultHeading} tabIndex={-1}>
                {planner.trip ? 'Your trip plan' : 'Room for the road ahead'}
              </h2>
              <span className={planner.trip ? 'ready-label' : 'muted'}>
                {planner.trip ? (
                  <>
                    <Icon name="check" size={15} />
                    Plan ready
                  </>
                ) : (
                  'Start with the details on the left'
                )}
              </span>
            </div>
            <div className="sr-only" aria-live="polite" aria-atomic="true">
              {planner.notice}
            </div>
            {planner.notice && !planner.trip && <p className="inline-notice">{planner.notice}</p>}
            {planner.error && <TripErrorBanner error={planner.error} onRefresh={planner.reload} />}
            <TripSummary trip={planner.trip} />
            <RouteMap
              mapKey={planner.bootstrap?.map_key ?? ''}
              trip={planner.trip}
              busy={planner.busy}
              selectedStop={selectedStop}
              onSelectStop={setSelectedStop}
            />
            <div className="route-details-grid">
              <Itinerary
                trip={planner.trip}
                selectedStop={selectedStop}
                onSelectStop={setSelectedStop}
              />
              <Directions trip={planner.trip} />
            </div>
          </div>
        </div>
        <DailyLogs key={planner.trip?.id ?? 'empty'} trip={planner.trip} />
        <Assumptions
          assumptions={planner.trip?.assumptions ?? planner.bootstrap?.assumptions ?? []}
          limits={planner.bootstrap?.limits}
        />
      </main>
      <footer className="site-footer">
        <span className="footer-brand">
          spotter<span>.</span>
        </span>
        <p>Made for the planning, not the paperwork.</p>
        <span>Projected plans. Real-world judgment required.</span>
      </footer>
    </>
  );
}
