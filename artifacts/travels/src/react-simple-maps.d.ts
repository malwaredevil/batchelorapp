declare module "react-simple-maps" {
  import { type ReactNode, type MouseEvent } from "react";

  interface ComposableMapProps {
    projection?: string;
    projectionConfig?: Record<string, unknown>;
    width?: number;
    height?: number;
    style?: React.CSSProperties;
    className?: string;
    children?: ReactNode;
  }
  export function ComposableMap(props: ComposableMapProps): JSX.Element;

  interface GeographiesProps {
    geography: string | object;
    children: (args: { geographies: Geography[] }) => ReactNode;
  }
  interface Geography {
    rsmKey: string;
    [key: string]: unknown;
  }
  export function Geographies(props: GeographiesProps): JSX.Element;

  interface GeographyProps {
    geography: Geography;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    style?: {
      default?: React.CSSProperties;
      hover?: React.CSSProperties;
      pressed?: React.CSSProperties;
    };
  }
  export function Geography(props: GeographyProps): JSX.Element;

  interface MarkerProps {
    coordinates: [number, number];
    onClick?: (event: MouseEvent<SVGGElement>) => void;
    onMouseEnter?: (event: MouseEvent<SVGGElement>) => void;
    onMouseLeave?: (event: MouseEvent<SVGGElement>) => void;
    children?: ReactNode;
  }
  export function Marker(props: MarkerProps): JSX.Element;

  interface ZoomableGroupProps {
    center?: [number, number];
    zoom?: number;
    children?: ReactNode;
  }
  export function ZoomableGroup(props: ZoomableGroupProps): JSX.Element;
}
