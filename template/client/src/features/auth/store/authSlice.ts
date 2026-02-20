import { createSlice } from '@reduxjs/toolkit';

import type { PayloadAction } from '@reduxjs/toolkit';
import type { IAuthState, IUser } from '../types/auth.types';

const initialState: IAuthState = {
  user: null,
  isAuthenticated: false,
  isInitializing: true,
  isLoggingOut: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<IUser>) => {
      state.user = action.payload;
      state.isAuthenticated = true;
      state.isInitializing = false;
      state.isLoggingOut = false;
    },
    setInitialized: (state) => {
      state.isInitializing = false;
    },
    setLoggingOut: (state, action: PayloadAction<boolean>) => {
      state.isLoggingOut = action.payload;
    },
    logout: (state) => {
      state.user = null;
      state.isAuthenticated = false;
      state.isLoggingOut = false;
    },
  },
});

export const { setUser, setInitialized, setLoggingOut, logout } = authSlice.actions;
export default authSlice.reducer;
