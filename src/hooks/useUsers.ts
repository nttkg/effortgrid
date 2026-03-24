import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { notifications } from '@mantine/notifications';
import { User } from '../types';

export interface UserPayload {
  name: string;
  role: string;
  email: string | null;
  dailyCapacity: number | null;
}

export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<User[]>('list_users');
      setUsers(result);
    } catch (error) {
      console.error('Failed to fetch users:', error);
      notifications.show({
        title: 'Error',
        message: 'Failed to load users.',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const addUser = async (payload: UserPayload) => {
    try {
      await invoke('add_user', { payload });
      await fetchUsers(); // Refresh the list
      notifications.show({
        title: 'Success',
        message: 'User added successfully.',
        color: 'green',
      });
    } catch (error) {
      console.error('Failed to add user:', error);
      notifications.show({
        title: 'Error',
        message: 'Failed to add user.',
        color: 'red',
      });
    }
  };

  const updateUser = async (id: number, payload: UserPayload) => {
    try {
      await invoke('update_user', { payload: { id, ...payload } });
      await fetchUsers(); // Refresh the list
      notifications.show({
        title: 'Success',
        message: 'User updated successfully.',
        color: 'green',
      });
    } catch (error) {
      console.error('Failed to update user:', error);
      notifications.show({
        title: 'Error',
        message: 'Failed to update user.',
        color: 'red',
      });
    }
  };

  const deleteUser = async (id: number) => {
    try {
      await invoke('delete_user', { id });
      await fetchUsers(); // Refresh the list
      notifications.show({
        title: 'Success',
        message: 'User deleted successfully.',
        color: 'green',
      });
    } catch (error) {
      console.error('Failed to delete user:', error);
      notifications.show({
        title: 'Error',
        message: 'Failed to delete user. They might be associated with existing records.',
        color: 'red',
      });
    }
  };

  return { users, loading, fetchUsers, addUser, updateUser, deleteUser };
}
