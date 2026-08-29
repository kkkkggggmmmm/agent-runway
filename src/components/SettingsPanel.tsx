interface SettingsPanelProps {
  reservePercent: number;
  onReserveChange: (value: number) => void;
  desktop?: {
    autostartEnabled: boolean;
    autostartLoading: boolean;
    autostartError: string | null;
    onAutostartChange: (enabled: boolean) => void;
  };
}

export const SettingsPanel = ({ reservePercent, onReserveChange, desktop }: SettingsPanelProps) => (
  <section className="settings-card">
    <div className="card-heading compact">
      <div>
        <p className="section-kicker">GUARDRAIL</p>
        <h2>予備枠</h2>
      </div>
      <strong className="reserve-value">{reservePercent}%</strong>
    </div>
    <label className="slider-label" htmlFor="reserve-slider">
      <span>週末・緊急作業のために残す</span>
      <input
        id="reserve-slider"
        type="range"
        min="0"
        max="30"
        step="5"
        value={reservePercent}
        onChange={(event) => onReserveChange(Number(event.currentTarget.value))}
      />
    </label>
    <div className="slider-scale" aria-hidden="true"><span>0%</span><span>30%</span></div>
    {desktop ? (
      <div className="native-setting">
        <div>
          <strong>ログイン時に起動</strong>
          <p>ウィンドウを閉じてもトレイで監視を続けます</p>
          {desktop.autostartError ? <p className="setting-error" role="alert">{desktop.autostartError}</p> : null}
        </div>
        <label className="switch-control">
          <span className="visually-hidden">ログイン時にAgent Runwayを起動</span>
          <input
            type="checkbox"
            role="switch"
            checked={desktop.autostartEnabled}
            disabled={desktop.autostartLoading}
            onChange={(event) => desktop.onAutostartChange(event.currentTarget.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
        </label>
      </div>
    ) : null}
  </section>
);
