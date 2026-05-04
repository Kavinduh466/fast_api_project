import json
import os

class FeedbackLearner:
    def __init__(self, memory_file="rl_memory.json"):
        self.memory_file = memory_file
        # This dictionary stores the "Strictness Weight" for each rule.
        # Format: { "healthcare_min_button": 1.0, "web_contrast": 1.0 }
        self.weights = self.load_memory()
        
    def load_memory(self):
        if os.path.exists(self.memory_file):
            with open(self.memory_file, 'r') as f:
                print(" RL Agent: Memory loaded.")
                return json.load(f)
        return {}

    def save_memory(self):
        with open(self.memory_file, 'w') as f:
            json.dump(self.weights, f)

    def should_flag_violation(self, profile, rule_name):
        """
        Decides if we should bother the user with this error.
        If the user keeps rejecting this error, the weight drops below 0.5.
        """
        key = f"{profile}_{rule_name}"
        current_weight = self.weights.get(key, 1.0) # Default to 1.0 (Strict)
        
        # If weight is too low, the AI learns to ignore it
        if current_weight < 0.4:
            return False 
        return True

    def update_policy(self, profile, rule_name, user_feedback):
        """
        RL UPDATE STEP:
        user_feedback: +1 (Good catch) or -1 (Bad catch, ignore this)
        """
        key = f"{profile}_{rule_name}"
        current_weight = self.weights.get(key, 1.0)
        
        # Learning Rate (How fast it adapts)
        learning_rate = 0.2
        
        # Update the weight
        new_weight = current_weight + (learning_rate * user_feedback)
        
        # Clamp values between 0 (Always Ignore) and 2 (Super Strict)
        new_weight = max(0.0, min(new_weight, 2.0))
        
        self.weights[key] = new_weight
        self.save_memory()
        
        status = "Strengthened" if user_feedback > 0 else "Relaxed"
        return f"Policy updated. Rule '{rule_name}' {status} (Weight: {new_weight:.2f})"