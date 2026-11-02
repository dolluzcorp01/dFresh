// The signed-in admin's context (me, languages...), shared by every admin screen and block.
import { createContext, useContext } from 'react';

export const AdminContext = createContext(null);
export const useAdmin = () => useContext(AdminContext);
