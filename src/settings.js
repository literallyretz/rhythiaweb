// Subset of SettingsProfile.cs defaults (verified against the C# constructors) needed for the
// loading / home / gameplay / results flow. Everything here is a plain value; the full settings
// editor is out of scope for this build.
export function createSettings() {
  const s = {
    Sensitivity: 0.5,
    AbsoluteSensitivity: 1.0,
    AbsoluteInput: false,
    CursorDrift: true,
    ApproachRate: 30,
    ApproachDistance: 15,
    ApproachTime: 0,            // computed below (updateApproachTime)
    FadeIn: 10,
    FadeOut: 75,
    Pushback: true,
    CameraParallax: 0.25,
    FoV: 70,
    SpaceHitEffects: true,
    NoteOpacity: 1,
    NoteOpacityExponent: 1.25,
    NoteSize: 1,
    CursorScale: 1,
    CursorOpacity: 1,
    CursorRotation: 0,
    GridGuides: true,
    HitPopups: true,
    MissPopups: true,
    LocalOffset: 0,
    AlwaysPlayHitSound: false,
    EnableHitSound: true,
    EnableMissSound: true,
    VolumeMaster: 50,
    VolumeMusic: 50,
    VolumeSFX: 50,
    VolumeHitSound: 50,
    VolumeMissSound: 50,
    HPLerpValue: 60,
  };
  s.ApproachTime = s.ApproachDistance / s.ApproachRate; // SettingsProfile.updateApproachTime
  return s;
}
