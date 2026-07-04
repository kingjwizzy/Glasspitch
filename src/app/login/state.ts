// Plain (NON-'use server') module for the login form's state shape + initial
// value. These live HERE, not in actions.ts, because a "use server" file may
// export ONLY async functions — exporting the INITIAL_LOGIN_STATE object from
// there throws at runtime ("A 'use server' file can only export async
// functions, found object", nextjs.org/docs/messages/invalid-use-server-value)
// and crashes /login into the error boundary. actions.ts imports the TYPE from
// here; LoginForm imports the initial value from here.

export interface LoginFormState {
  status: 'idle' | 'sent' | 'error';
  message: string;
}

export const INITIAL_LOGIN_STATE: LoginFormState = { status: 'idle', message: '' };
