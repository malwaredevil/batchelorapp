export interface FeatureRegistrationBase {
  id: string;
}

export interface FeatureRegistry<TFeature extends FeatureRegistrationBase> {
  register: (feature: TFeature) => void;
  list: () => readonly TFeature[];
}

/**
 * Creates an artifact-local feature registry with consistent idempotent
 * registration. Each SPA owns its instance and its domain-specific feature
 * type; the lifecycle and duplicate protection are shared.
 */
export function createFeatureRegistry<
  TFeature extends FeatureRegistrationBase,
>(): FeatureRegistry<TFeature> {
  const features: TFeature[] = [];

  return {
    register(feature) {
      if (features.some((existing) => existing.id === feature.id)) return;
      features.push(feature);
    },
    list() {
      return features;
    },
  };
}
