export interface ForecastDateCoverage {
  status: "covered" | "partial" | "outside" | "undated";
  requestedStartDate: string | null;
  requestedEndDate: string | null;
  availableStartDate: string | null;
  availableEndDate: string | null;
  matchingDates: string[];
  summary: string;
}

function isIsoDate(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function evaluateForecastDateCoverage(input: {
  forecastDates: string[];
  requestedStartDate?: string | null;
  requestedEndDate?: string | null;
}): ForecastDateCoverage {
  const dates = [...new Set(input.forecastDates.filter(isIsoDate))].sort();
  const availableStartDate = dates[0] ?? null;
  const availableEndDate = dates.at(-1) ?? null;
  const requestedStartDate = isIsoDate(input.requestedStartDate)
    ? input.requestedStartDate
    : null;
  const requestedEndDate = isIsoDate(input.requestedEndDate)
    ? input.requestedEndDate
    : requestedStartDate;

  if (!requestedStartDate || !requestedEndDate) {
    return {
      status: "undated",
      requestedStartDate,
      requestedEndDate,
      availableStartDate,
      availableEndDate,
      matchingDates: dates,
      summary:
        availableStartDate && availableEndDate
          ? `Forecast covers ${availableStartDate} through ${availableEndDate}`
          : "No dated forecast coverage was returned",
    };
  }

  const matchingDates = dates.filter(
    (date) => date >= requestedStartDate && date <= requestedEndDate,
  );
  const fullyCovered =
    !!availableStartDate &&
    !!availableEndDate &&
    requestedStartDate >= availableStartDate &&
    requestedEndDate <= availableEndDate;
  const status =
    matchingDates.length === 0
      ? "outside"
      : fullyCovered
        ? "covered"
        : "partial";
  const summary =
    status === "covered"
      ? `Forecast covers the requested ${requestedStartDate} through ${requestedEndDate} dates`
      : status === "partial"
        ? `Forecast only partially covers ${requestedStartDate} through ${requestedEndDate}; available coverage is ${availableStartDate ?? "unknown"} through ${availableEndDate ?? "unknown"}`
        : `Requested dates ${requestedStartDate} through ${requestedEndDate} are outside the available forecast ${availableStartDate ?? "unknown"} through ${availableEndDate ?? "unknown"}`;

  return {
    status,
    requestedStartDate,
    requestedEndDate,
    availableStartDate,
    availableEndDate,
    matchingDates,
    summary,
  };
}
