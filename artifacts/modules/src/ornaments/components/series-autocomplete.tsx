import { useListOrnamentSeries } from "@workspace/api-client-react";
import {
  SingleValueAutocomplete,
  type SingleValueAutocompleteProps,
} from "@workspace/collection-ui";

type SeriesAutocompleteProps = Omit<
  SingleValueAutocompleteProps,
  "suggestions"
>;

export function SeriesAutocomplete(props: SeriesAutocompleteProps) {
  const { data: series = [] } = useListOrnamentSeries();

  return (
    <SingleValueAutocomplete
      {...props}
      suggestions={series.map((item) => item.seriesOrCollection)}
    />
  );
}
