import pandas as pd
import os

class RuleEngine:
    def __init__(self, excel_file="UI_RULE_SETS.xlsx"):
        self.excel_file = excel_file
        self.current_rules = {}
        # These act as the "Safety Net" if  Excel file has no numbers
        self.defaults = {
            "min_button_height": 44,
            "min_field_height": 40,
            "max_misalignment": 4
        }
        self.text_rules = [] #  will store the text rules (like HIPAA) here

    def load_rules(self, profile_name):
        sheet_map = {
            "apple": "Apple HIG", "ios": "Apple HIG",
            "google": "Google Material Design", "material": "Google Material Design",
            "android": "Android",
            "microsoft": "Microsoft Fluent", "fluent": "Microsoft Fluent",
            "healthcare": "Healthcare",
            "ecommerce": "E-commerce",
            "gaming": "Gaming",
            "enterprise": "Enterprise", "b2b": "Enterprise",
            "web": "Web Standards",
            "universal": "Universal Rules",
            "all": "All Rules",
            "overview": "Overview"
        }
        
        target_sheet = sheet_map.get(profile_name.lower(), "Universal Rules")
        print(f" Opening '{self.excel_file}' -> Sheet: '{target_sheet}'...")
        
        try:
            # Load sheet without assuming headers (header=None)
            df = pd.read_excel(self.excel_file, sheet_name=target_sheet, header=None)
            
            self.current_rules = {}
            self.text_rules = []
            
            for index, row in df.iterrows():
                # Skip the first row if it seems to be headers like "Rule ID", "Rule Name"
                if index == 0 and str(row.values[0]).lower().strip() == "rule id":
                    continue
                
                # Convert row to a single string to search for keywords easily
                row_str = str(row.values).lower()
                key = None
                # Capture rules that aren't clearly math-based but are descriptive
                if not key:
                    # If it's not a math rule, it's likely a policy/text rule
                    # We look for rows that have a description in the 3rd column (index 2)
                    if len(row) > 2 and pd.notna(row[2]) and str(row[2]).strip():
                        # Store both Name (row[1]) and Description (row[2]) in a dictionary
                        rule_name = str(row[1]).strip() if pd.notna(row[1]) else f"Rule_{index}"
                        self.text_rules.append({
                            "name": rule_name,
                            "description": str(row[2]).strip()
                        })

                # --- B. CAPTURE MATH RULES (For the Python Judge) ---
                key = None
                if "button" in row_str and ("height" in row_str or "size" in row_str):
                    key = "min_button_height"
                elif ("field" in row_str or "input" in row_str) and "height" in row_str:
                    key = "min_field_height"
                elif "align" in row_str:
                    key = "max_misalignment"
                
                if not key:
                    continue

                # Hunt for the Value (Find the first number in the row)
                for cell in row:
                    val_str = str(cell)
                    # Extract digits (e.g., "44px" -> "44")
                    digits = ''.join(filter(str.isdigit, val_str))
                    
                    if digits and int(digits) > 0:
                        self.current_rules[key] = int(digits)
                        break # Stop after finding the first number
                
            # Final Report
            if self.current_rules:
                print(f" Loaded Math Rules: {self.current_rules}")
            else:
                print(f" No pixel dimensions found. Using Defaults ({self.defaults['min_button_height']}px).")
                print("   (This is normal if your Excel sheet only contains text policies like HIPAA)")
                self.current_rules = self.defaults

        except Exception as e:
            print(f" Error: {e}")
            self.current_rules = self.defaults

    def get(self, key):
        return self.current_rules.get(key, self.defaults.get(key))