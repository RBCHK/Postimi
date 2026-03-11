"use client";

import { useState, useCallback, useEffect } from "react";
import type { XProfile } from "@/lib/types";

const STORAGE_KEY = "x-profile";

const DEFAULT_PROFILE: XProfile = {
  name: "",
  username: "",
  bio: "",
  followers: "",
  following: "",
};

export function useXProfile() {
  const [profile, setProfile] = useState<XProfile>(DEFAULT_PROFILE);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setProfile({ ...DEFAULT_PROFILE, ...JSON.parse(raw) });
    } catch {
      // ignore
    }
  }, []);

  const updateProfile = useCallback((updates: Partial<XProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...updates };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { profile, updateProfile };
}
