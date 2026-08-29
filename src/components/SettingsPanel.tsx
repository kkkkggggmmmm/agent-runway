interface SettingsPanelProps {
  reservePercent: number;
  onReserveChange: (value: number) => void;
}

export const SettingsPanel = ({ reservePercent, onReserveChange }: SettingsPanelProps) => (
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
  </section>
);
