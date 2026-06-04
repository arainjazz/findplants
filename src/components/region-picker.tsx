import { CHINA_REGIONS, getCitiesOf, getCountiesOf } from "@/lib/regions";

type Props = {
  province: string;
  city: string;
  county: string;
  onChange: (next: { province: string; city: string; county: string }) => void;
};

const selectCls =
  "border border-ink px-3 py-2 bg-background text-sm focus:outline-none focus:border-vermilion";

export function RegionPicker({ province, city, county, onChange }: Props) {
  const cities = province ? getCitiesOf(province) : [];
  const counties = province && city ? getCountiesOf(province, city) : [];
  return (
    <div className="flex flex-wrap gap-2">
      <select
        className={selectCls}
        value={province}
        onChange={(e) => onChange({ province: e.target.value, city: "", county: "" })}
      >
        <option value="">省 / 直辖市 / 自治区 *</option>
        {CHINA_REGIONS.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
      <select
        className={selectCls}
        value={city}
        disabled={!province || cities.length === 0}
        onChange={(e) => onChange({ province, city: e.target.value, county: "" })}
      >
        <option value="">市 / 州（可选）</option>
        {cities.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        className={selectCls}
        value={county}
        disabled={!city || counties.length === 0}
        onChange={(e) => onChange({ province, city, county: e.target.value })}
      >
        <option value="">区 / 县（可选）</option>
        {counties.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}