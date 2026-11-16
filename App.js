import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, FlatList,
  Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BACKEND_URL, USER_PHONE } from './config';
import { parseTime, formatWhen } from './utils/time';

const STORAGE_KEY = '@tasks_v1';

// Show notifications even while the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, // SDK <= 52
    shouldShowBanner: true, // SDK >= 53
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [taskText, setTaskText] = useState('');
  const [taskTime, setTaskTime] = useState('');
  const [reminderType, setReminderType] = useState('push'); // 'push' | 'sms' | 'call'
  const loaded = useRef(false);

  useEffect(() => {
    registerForPushNotifications();
    loadTasks();
  }, []);

  // Persist tasks whenever they change (after the initial load).
  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)).catch((e) =>
      console.warn('Failed to save tasks', e)
    );
  }, [tasks]);

  const loadTasks = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) setTasks(JSON.parse(raw));
    } catch (e) {
      console.warn('Failed to load tasks', e);
    } finally {
      loaded.current = true;
    }
  };

  const registerForPushNotifications = async () => {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('reminders', {
        name: 'Reminders',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      });
    }
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow notifications to use this app.');
    }
  };

  // Returns the notification id so it can be cancelled later.
  const scheduleLocalNotification = (title, body, date) =>
    Notifications.scheduleNotificationAsync({
      content: { title, body, sound: 'default' },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
        channelId: 'reminders',
      },
    });

  // Asks the backend to SMS/call at `remindAt`. The backend (see /backend)
  // holds the Twilio credentials and does the scheduling.
  const scheduleBackendReminder = async (task) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/send-reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: USER_PHONE,
          message: `Reminder: ${task.text}`,
          type: task.reminderType, // 'call' | 'sms'
          sendAt: task.remindAt,
        }),
      });
      if (!response.ok) throw new Error(`Backend responded ${response.status}`);
      const data = await response.json();
      return { backendId: data.id };
    } catch (error) {
      console.warn('Error contacting backend:', error);
      // Fall back to a local notification at the same time.
      const notificationId = await scheduleLocalNotification(
        'Task Reminder', task.text, new Date(task.remindAt)
      );
      Alert.alert(
        'Backend unavailable',
        `Couldn't schedule the ${task.reminderType.toUpperCase()}. A push notification was scheduled instead.`
      );
      return { notificationId };
    }
  };

  const cancelReminder = async (task) => {
    try {
      if (task.notificationId) {
        await Notifications.cancelScheduledNotificationAsync(task.notificationId);
      }
      if (task.backendId) {
        await fetch(`${BACKEND_URL}/api/send-reminder/${task.backendId}`, { method: 'DELETE' });
      }
    } catch (e) {
      console.warn('Failed to cancel reminder', e);
    }
  };

  const addTask = async () => {
    if (!taskText.trim()) {
      Alert.alert('Error', 'Please enter a task description.');
      return;
    }

    let remindAt = null;
    if (taskTime.trim()) {
      remindAt = parseTime(taskTime);
      if (!remindAt) {
        Alert.alert('Invalid time', 'Use a format like "5:00 PM", "17:30" or "in 10 min".');
        return;
      }
    }

    const newTask = {
      id: Date.now().toString(),
      text: taskText.trim(),
      remindAt: remindAt ? remindAt.toISOString() : null,
      reminderType,
      completed: false,
    };

    if (remindAt) {
      if (reminderType === 'push') {
        newTask.notificationId = await scheduleLocalNotification('Task Reminder', newTask.text, remindAt);
      } else {
        Object.assign(newTask, await scheduleBackendReminder(newTask));
      }
    }

    setTasks((prev) => [newTask, ...prev]);

    setTaskText('');
    setTaskTime('');
    setReminderType('push');
    setModalVisible(false);
  };

  const toggleComplete = (id) => {
    setTasks((prev) => prev.map((task) => {
      if (task.id !== id) return task;
      // Completing a task cancels its pending reminder.
      if (!task.completed) {
        cancelReminder(task);
        return { ...task, completed: true, notificationId: undefined, backendId: undefined };
      }
      return { ...task, completed: false };
    }));
  };

  const deleteTask = (id) => {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === id);
      if (task) cancelReminder(task);
      return prev.filter((t) => t.id !== id);
    });
  };

  const getReminderIcon = (type) => {
    if (type === 'call') return '📞';
    if (type === 'sms') return '💬';
    return '🔔';
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My AI Assistant</Text>
        <Text style={styles.headerSub}>Stay on track, stay focused.</Text>
      </View>

      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContainer}
        renderItem={({ item }) => (
          <View style={[styles.taskCard, item.completed && styles.completedCard]}>
            <TouchableOpacity onPress={() => toggleComplete(item.id)} style={styles.checkbox}>
              <Text style={styles.checkIcon}>{item.completed ? '✅' : '⬜'}</Text>
            </TouchableOpacity>
            <View style={styles.taskDetails}>
              <Text style={[styles.taskText, item.completed && styles.completedText]}>
                {item.text}
              </Text>
              <Text style={styles.taskMeta}>
                {getReminderIcon(item.reminderType)} {formatWhen(item.remindAt)}
              </Text>
            </View>
            <TouchableOpacity onPress={() => deleteTask(item.id)}>
              <Text style={styles.deleteBtn}>🗑️</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No tasks yet. Add one below!</Text>}
      />

      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Modal
        animationType="slide"
        transparent
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Task & Reminder</Text>

            <TextInput
              style={styles.input}
              placeholder="What do you need to do?"
              value={taskText}
              onChangeText={setTaskText}
            />
            <TextInput
              style={styles.input}
              placeholder='Time (e.g. 5:00 PM, 17:30, in 10 min)'
              value={taskTime}
              onChangeText={setTaskTime}
            />

            <Text style={styles.label}>How should I remind you?</Text>
            <View style={styles.radioGroup}>
              {['push', 'sms', 'call'].map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.radioBtn, reminderType === type && styles.radioBtnActive]}
                  onPress={() => setReminderType(type)}
                >
                  <Text style={[styles.radioText, reminderType === type && styles.radioTextActive]}>
                    {getReminderIcon(type)} {type.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={addTask}>
                <Text style={styles.saveText}>Save & Schedule</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  header: { paddingTop: 60, paddingBottom: 20, paddingHorizontal: 20, backgroundColor: '#4A90E2' },
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  headerSub: { fontSize: 14, color: '#d0e3ff', marginTop: 5 },
  listContainer: { padding: 20, paddingBottom: 100 },
  taskCard: { flexDirection: 'row', backgroundColor: '#fff', padding: 15, borderRadius: 12, marginBottom: 15, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
  completedCard: { backgroundColor: '#e8f5e9', opacity: 0.7 },
  checkbox: { justifyContent: 'center', marginRight: 15 },
  checkIcon: { fontSize: 24 },
  taskDetails: { flex: 1 },
  taskText: { fontSize: 16, fontWeight: '600', color: '#333' },
  completedText: { textDecorationLine: 'line-through', color: '#888' },
  taskMeta: { fontSize: 12, color: '#666', marginTop: 5 },
  deleteBtn: { fontSize: 20, paddingLeft: 10 },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 50, fontSize: 16 },
  fab: { position: 'absolute', bottom: 30, right: 30, backgroundColor: '#4A90E2', width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 5 },
  fabText: { fontSize: 30, color: '#fff', marginTop: -2 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: '#fff', padding: 25, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  modalTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 15, fontSize: 16 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 10, color: '#555' },
  radioGroup: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 25 },
  radioBtn: { flex: 1, padding: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, marginHorizontal: 5, alignItems: 'center' },
  radioBtnActive: { backgroundColor: '#4A90E2', borderColor: '#4A90E2' },
  radioText: { color: '#333', fontWeight: '600' },
  radioTextActive: { color: '#fff' },
  modalButtons: { flexDirection: 'row', justifyContent: 'space-between' },
  cancelBtn: { flex: 1, padding: 15, alignItems: 'center', marginRight: 10, backgroundColor: '#f0f0f0', borderRadius: 8 },
  cancelText: { color: '#666', fontWeight: '600' },
  saveBtn: { flex: 1, padding: 15, alignItems: 'center', marginLeft: 10, backgroundColor: '#4A90E2', borderRadius: 8 },
  saveText: { color: '#fff', fontWeight: '600' },
});
