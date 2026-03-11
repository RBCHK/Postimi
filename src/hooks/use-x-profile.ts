"use client";

import { useState, useCallback } from "react";
import type { XProfile } from "@/lib/types";

const STORAGE_KEY = "x-profile";

const DEFAULT_PROFILE: XProfile = {
  name: "",
  username: "",
  bio: "",
  followers: "",
  following: "",
};

function loadProfile(): XProfile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function useXProfile() {
  const [profile, setProfile] = useState<XProfile>(loadProfile);

  const updateProfile = useCallback((updates: Partial<XProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...updates };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { profile, updateProfile };
}
